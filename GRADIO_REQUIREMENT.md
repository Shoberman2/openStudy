# Gradio Requirement

OpenStudy must be built with Gradio.

All user-facing application features must run through a Gradio interface so the project works directly on Hugging Face Spaces with the Gradio SDK.

## Required Implementation

- The main app entry point must be `app.py`.
- The Hugging Face Space metadata must use `sdk: gradio`.
- Dependencies must be listed in `requirements.txt`.
- Search, upload, project review, tables, plots, downloads, and reports must be exposed through Gradio components.
- The app should launch with `demo.launch()` or an equivalent Gradio launch wrapper.

## Not Allowed As Replacements

- Do not replace the Gradio app with Streamlit, Flask, Django, FastAPI-only pages, React, Next.js, or another frontend framework.
- Do not move the primary user experience outside Gradio.
- Backend helpers are allowed only when they support the Gradio app.

## Deployment Target

The app must remain compatible with Hugging Face Spaces using the Gradio SDK.

## AI Model Requirement

Any AI agent review must use `Qwen/Qwen3.6-27B` only. Do not add fallback models or alternate LLM providers.
