---
title: OpenStudy
emoji: 🔬
colorFrom: green
colorTo: yellow
sdk: gradio
app_file: app.py
pinned: false
license: mit
---

# OpenStudy

OpenStudy is an open-source Gradio app for screening research studies for reported bias controls, study conduct details, ethics safeguards, funding disclosures, and transparency signals.

Users can:

- Search public study metadata by DOI, URL, title, or keywords — up to 100 studies per topic — and evaluate a result with one click.
- Evaluate abstracts and available metadata from public sources, with plain-language explanations of what every score and category means.
- Define their own screening standards and parameters — categories that count, safeguards that must be reported, a minimum score, adjustable risk thresholds, and custom required terms — and get a pass/fail verdict against them on every evaluation.
- Add their own research study (PDF, DOCX, text, or pasted manuscript) to screen it for bias-control and credibility safeguards against those standards.
- Upload their own research projects, protocols, benchmark plans, or preregistrations to review planned conduct before or during a study.
- Keep an in-session project dashboard and export project summaries as JSON.
- Run an optional Qwen agent review using `Qwen/Qwen3.6-27B` only.
- Download a Markdown report with evidence snippets and follow-up questions.

## Required AI model

OpenStudy's AI review path is restricted to `Qwen/Qwen3.6-27B` only. It does not fall back to another model.

For Hugging Face Spaces, configure a Space secret named `HF_TOKEN` with access to the model or paste a temporary token into the Qwen review control in the app.

## Important limitation

OpenStudy is a decision-support checklist. It flags what appears to be reported or missing in the supplied text. It does not certify that a study is ethical, unethical, biased, unbiased, valid, or invalid.

## Run locally

```bash
pip install -r requirements.txt
python app.py
```

## Deploy on Hugging Face Spaces

Create a new Space using the Gradio SDK, then upload this repository. Hugging Face Spaces installs `requirements.txt` and runs `app.py`.
