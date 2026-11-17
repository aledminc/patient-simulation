import { expect, test } from "@playwright/test";

function observeFailures(page) {
  const failures = [];
  page.on("console", message => { if (message.type() === "error") failures.push(`console: ${message.text()}`); });
  page.on("pageerror", error => failures.push(`pageerror: ${error.message}`));
  page.on("requestfailed", request => failures.push(`requestfailed: ${request.url()} ${request.failure()?.errorText}`));
  page.on("response", response => { if (response.status() >= 400) failures.push(`http ${response.status()}: ${response.url()}`); });
  return failures;
}

test("complete typed encounter works without a backend or model", async ({ page }) => {
  const failures = observeFailures(page);
  const response = await page.goto("/");
  expect(response.status()).toBe(200);
  expect(response.headers()["cross-origin-opener-policy"]).toBe("same-origin");
  expect(response.headers()["cross-origin-embedder-policy"]).toBe("require-corp");

  await expect(page.getByRole("heading", { name: "Choose a patient" })).toBeVisible();
  await page.locator(".card").first().click();
  await page.getByRole("button", { name: "Begin conversation" }).click();
  await page.locator("#msg").fill("Hello, my name is Alex.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.locator(".msg.pt .bubble")).toBeVisible();
  await page.getByRole("button", { name: /End conversation/ }).click();
  await expect(page.getByRole("heading", { name: /Your conversation with/ })).toBeVisible();
  expect(failures).toEqual([]);
});

test("model-free compatibility keeps voice controls safe and typed input active", async ({ page }) => {
  const failures = observeFailures(page);
  await page.goto("/");
  await page.locator(".card").nth(1).click();
  await page.getByRole("button", { name: "Begin conversation" }).click();
  await expect(page.locator("#recordButton")).toBeDisabled();
  await expect(page.locator("#msg")).toBeEnabled();
  await expect(page.locator("#voiceStatus")).toContainText(/Typed input|cannot record/);
  expect(failures).toEqual([]);
});

test("service worker supports an offline reload", async ({ page, context }) => {
  const failures = observeFailures(page);
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Choose a patient" })).toBeVisible();
  await context.setOffline(false);
  expect(failures.filter(failure => !failure.includes("ERR_INTERNET_DISCONNECTED"))).toEqual([]);
});

test("simulated worker inference does not freeze the main thread", async ({ page }) => {
  await page.goto("/");
  const frames = await page.evaluate(async () => {
    const source = `onmessage=()=>{const end=performance.now()+300;while(performance.now()<end){};postMessage('done')}`;
    const worker = new Worker(URL.createObjectURL(new Blob([source], { type: "text/javascript" })));
    let frameCount = 0;
    let running = true;
    const count = () => { frameCount += 1; if (running) requestAnimationFrame(count); };
    requestAnimationFrame(count);
    await new Promise(resolve => { worker.onmessage = resolve; worker.postMessage("start"); });
    running = false;
    worker.terminate();
    return frameCount;
  });
  expect(frames).toBeGreaterThan(3);
});

