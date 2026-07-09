# AI-Powered Chart Generator

## Project Overview

A simple AI-powered chart generator.

Workflow:

User JSON
↓
FastAPI
↓
OpenAI GPT-4o
↓
Chart.js Configuration JSON
↓
Frontend
↓
Rendered Chart

## Installation

1. `cd backend`
2. `python -m venv venv`
3. Activate environment
   - Windows: `venv\Scripts\activate`
   - Linux/Mac: `source venv/bin/activate`
4. `pip install -r requirements.txt`
5. Copy `.env.example` to `.env`
6. Add OpenAI API Key
7. Run `uvicorn app:app --reload`
8. Open `frontend/index.html` (or serve it with a simple local server)
