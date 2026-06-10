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

- Search public study metadata by DOI, URL, title, or keywords.
- Evaluate abstracts and available metadata from public sources.
- Upload a PDF, text file, or pasted manuscript text for a deeper checklist review.
- Add their own research projects or protocols to review planned conduct before or during a study.
- Keep an in-session project dashboard and export project summaries as JSON.
- Download a Markdown report with evidence snippets and follow-up questions.

## Important limitation

OpenStudy is a decision-support checklist. It flags what appears to be reported or missing in the supplied text. It does not certify that a study is ethical, unethical, biased, unbiased, valid, or invalid.

## Run locally

```bash
pip install -r requirements.txt
python app.py
```

## Deploy on Hugging Face Spaces

Create a new Space using the Gradio SDK, then upload this repository. Hugging Face Spaces installs `requirements.txt` and runs `app.py`.
