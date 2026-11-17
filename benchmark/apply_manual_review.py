"""Merge a human/manual quality review into benchmark JSON and Markdown outputs."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import run_benchmark


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--results", required=True)
    parser.add_argument("--review", required=True)
    parser.add_argument("--report", required=True)
    args = parser.parse_args()

    results_path = Path(args.results).resolve()
    review_path = Path(args.review).resolve()
    report_path = Path(args.report).resolve()
    results = json.loads(results_path.read_text(encoding="utf-8"))
    review = json.loads(review_path.read_text(encoding="utf-8"))
    if review.get("resultGeneratedAt") != results.get("generatedAt"):
        raise SystemExit("Review does not match this benchmark run's generatedAt value")
    status = review.get("status")
    if status not in {"pass", "fail"}:
        raise SystemExit("Review status must be 'pass' or 'fail'")

    results["manualQualityReview"] = review
    results["gates"]["manualQualityReview"] = {
        "status": status,
        "observed": review.get("summary"),
        "target": "approved",
        "reason": review.get("rationale", ""),
    }
    concerns = results.setdefault("modelQualityConcerns", [])
    for concern in review.get("concerns", []):
        if concern not in concerns:
            concerns.append(concern)
    results["recommendation"] = run_benchmark.recommendation_for(results["mode"], results["gates"])
    run_benchmark.write_json(results_path, results)
    report_path.write_text(run_benchmark.markdown_report(results), encoding="utf-8", newline="\n")
    print(f"Merged manual review: {status}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

