from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pathlib import Path
from dotenv import load_dotenv
from google import genai
from pypdf import PdfReader
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

import os
import re
import shutil
import time


# ============================================================
# CONFIGURATION
# ============================================================

BASE_DIR = Path(__file__).resolve().parent

PAPERS_DIR = BASE_DIR / "papers"
PAPERS_DIR.mkdir(parents=True, exist_ok=True)

ENV_FILE = BASE_DIR / ".env"
load_dotenv(ENV_FILE)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()

gemini_client = None

if GEMINI_API_KEY:
    try:
        gemini_client = genai.Client(
            api_key=GEMINI_API_KEY
        )
        print("Gemini client initialized successfully.")
    except Exception as e:
        print("Gemini initialization error:", e)
else:
    print("WARNING: GEMINI_API_KEY not found in .env")


# ============================================================
# FASTAPI APP
# ============================================================

app = FastAPI(
    title="Research Paper Assistant",
    version="2.0.0"
)


# ============================================================
# CORS
# ============================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# REQUEST MODEL
# ============================================================

class QuestionRequest(BaseModel):
    question: str


# ============================================================
# READ PDF FILES
# ============================================================

def load_papers():

    papers = []

    pdf_files = sorted(
        PAPERS_DIR.glob("*.pdf"),
        key=lambda p: p.name.lower()
    )

    for pdf_file in pdf_files:

        try:

            reader = PdfReader(
                str(pdf_file)
            )

            pages = []

            for page_number, page in enumerate(
                reader.pages,
                start=1
            ):

                try:
                    text = page.extract_text() or ""
                except Exception:
                    text = ""

                text = re.sub(
                    r"\s+",
                    " ",
                    text
                ).strip()

                if text:

                    pages.append({
                        "page_number": page_number,
                        "text": text
                    })

            if pages:

                papers.append({
                    "filename": pdf_file.name,
                    "pages": pages
                })

        except Exception as e:

            print(
                f"Error reading {pdf_file.name}: {e}"
            )

    return papers


# ============================================================
# CREATE CHUNKS
# ============================================================

def create_chunks(
    text,
    chunk_size=350,
    overlap=70
):

    text = re.sub(
        r"\s+",
        " ",
        text
    ).strip()

    if not text:
        return []

    words = text.split()

    if len(words) <= chunk_size:
        return [text]

    chunks = []

    step = chunk_size - overlap

    if step <= 0:
        step = 1

    start = 0

    while start < len(words):

        end = start + chunk_size

        chunk = " ".join(
            words[start:end]
        ).strip()

        if chunk:
            chunks.append(chunk)

        if end >= len(words):
            break

        start += step

    return chunks


# ============================================================
# BUILD CHUNKS FROM ALL PAPERS
# ============================================================

def build_chunks():

    all_chunks = []
    metadata = []

    papers = load_papers()

    for paper in papers:

        filename = paper["filename"]

        for page in paper["pages"]:

            page_number = page["page_number"]

            chunks = create_chunks(
                page["text"]
            )

            for chunk_index, chunk in enumerate(
                chunks
            ):

                all_chunks.append(chunk)

                metadata.append({
                    "filename": filename,
                    "page_number": page_number,
                    "chunk_index": chunk_index
                })

    return all_chunks, metadata


# ============================================================
# RETRIEVE RELEVANT CONTENT
# ============================================================

def retrieve_relevant_chunks(
    question,
    top_k=12
):

    all_chunks, metadata = build_chunks()

    if not all_chunks:

        return []

    if not question.strip():

        return []

    try:

        vectorizer = TfidfVectorizer(
            stop_words="english",
            ngram_range=(1, 2),
            sublinear_tf=True,
            max_features=50000
        )

        vectors = vectorizer.fit_transform(
            all_chunks + [question]
        )

        question_vector = vectors[-1]

        document_vectors = vectors[:-1]

        similarities = cosine_similarity(
            question_vector,
            document_vectors
        )[0]

    except Exception as e:

        print(
            "Retrieval error:",
            e
        )

        return []

    scored_results = []

    for index, score in enumerate(
        similarities
    ):

        scored_results.append({

            "text": all_chunks[index],

            "filename": metadata[index]["filename"],

            "page_number": metadata[index]["page_number"],

            "chunk_index": metadata[index]["chunk_index"],

            "score": float(score)

        })

    scored_results.sort(
        key=lambda item: item["score"],
        reverse=True
    )

    question_lower = question.lower()

    multi_paper_question = any(
        phrase in question_lower
        for phrase in [
            "these papers",
            "the papers",
            "all papers",
            "uploaded papers",
            "each paper",
            "every paper",
            "compare",
            "comparison",
            "across the papers",
            "among the papers",
            "between the papers"
        ]
    )

    selected = []

    selected_keys = set()

    paper_counts = {}

    per_paper_limit = 3

    if not multi_paper_question:
        per_paper_limit = 2

    # --------------------------------------------------------
    # FIRST PASS
    # Try to include multiple papers.
    # --------------------------------------------------------

    for item in scored_results:

        filename = item["filename"]

        count = paper_counts.get(
            filename,
            0
        )

        if count >= per_paper_limit:
            continue

        if item["score"] < 0.01:
            continue

        key = (
            item["filename"],
            item["page_number"],
            item["chunk_index"]
        )

        if key in selected_keys:
            continue

        selected.append(item)

        selected_keys.add(key)

        paper_counts[filename] = count + 1

    # --------------------------------------------------------
    # SECOND PASS
    # Add strongest remaining results.
    # --------------------------------------------------------

    for item in scored_results:

        if len(selected) >= top_k:
            break

        key = (
            item["filename"],
            item["page_number"],
            item["chunk_index"]
        )

        if key in selected_keys:
            continue

        if item["score"] < 0.01:
            continue

        selected.append(item)

        selected_keys.add(key)

    selected.sort(
        key=lambda item: item["score"],
        reverse=True
    )

    return selected[:top_k]


# ============================================================
# BUILD GEMINI CONTEXT
# ============================================================

def build_context(results):

    context_parts = []

    for number, result in enumerate(
        results,
        start=1
    ):

        context_parts.append(
            f"""
SOURCE {number}

Paper:
{result["filename"]}

Page:
{result["page_number"]}

Retrieved Content:
{result["text"]}
"""
        )

    return "\n-----------------------------\n".join(
        context_parts
    )


# ============================================================
# GENERATE GEMINI ANSWER
# ============================================================

def generate_answer(
    question,
    results
):

    if not results:

        return (
            "I could not find relevant "
            "information in the uploaded "
            "research papers."
        )

    if gemini_client is None:

        return (
            "Gemini is not configured. "
            "Please check GEMINI_API_KEY "
            "inside backend/.env and "
            "restart the server."
        )

    paper_names = sorted(
        set(
            result["filename"]
            for result in results
        )
    )

    context = build_context(
        results
    )

    paper_list = "\n".join(
        f"- {name}"
        for name in paper_names
    )

    # --------------------------------------------------------
    # IMPORTANT RESEARCH PROMPT
    # --------------------------------------------------------

    prompt = f"""
You are an academic Research Paper Assistant.

You answer questions about uploaded research papers.

The user can ask ANY natural-language question.

USER QUESTION:
{question}

PAPERS FOUND IN THE RETRIEVED CONTENT:
{paper_list}

RETRIEVED CONTENT:
{context}


FOLLOW THESE RULES CAREFULLY:

1. Answer the user's actual question directly.

2. Use the retrieved research-paper content
   as the primary evidence.

3. Do NOT invent information.

4. Do NOT assume something is true just because
   it is generally true in machine learning,
   deep learning, artificial intelligence,
   or research.

5. If the authors explicitly state something,
   say:
   "The authors state that..."

6. If the paper does NOT explicitly provide
   a reason, do not pretend that the authors
   provided one.

7. If you provide an interpretation based on
   the paper, clearly label it as:
   "Based on the reported methodology..."

8. For review papers, distinguish between:
   - datasets discussed in the review
   - datasets actually used by the review authors
   - datasets used by studies cited by the review

9. If the question asks about multiple papers,
   examine the retrieved information from all
   available papers rather than relying on only
   one paper.

10. If appropriate, organize the answer using:

    - Direct answer
    - Paper-by-paper explanation
    - Comparison table
    - Important observation
    - Sources

11. For dataset questions, include when available:

    Dataset name
    Paper
    Number of images/samples
    Disease/classes
    Public/private availability

12. For methodology questions, include when available:

    Dataset
    Preprocessing
    Feature extraction
    Model/algorithm
    Training
    Evaluation

13. For algorithm questions, explain what algorithm
    is used and what role it plays.

14. For results questions, give reported metrics
    and values only when supported by the papers.

15. For limitation questions, distinguish between
    limitations explicitly stated by the authors
    and limitations inferred from the evidence.

16. For research-gap questions, distinguish between
    gaps explicitly identified by authors and
    reasonable gaps inferred from comparison.

17. For questions such as:

    "Why did the authors choose CNN?"

    do NOT automatically answer:

    "CNN was chosen because it is good at images."

    First determine whether the authors actually
    give that reason.

    If the paper gives an explicit reason,
    report that reason.

    If not, say that the paper does not explicitly
    state the reason and then provide a clearly
    labelled interpretation based on the methodology.

18. Do not use outside web information.

19. Do not fabricate citations.

20. Do not copy long sections of the paper.
    Summarize them in your own words.

21. Keep the answer clear enough for an MCA student.

22. At the end, provide:

    Sources:
    - filename, page number


Now answer the user's question.
"""


    # ========================================================
    # GEMINI RETRY SYSTEM
    # ========================================================

    max_retries = 3

    for attempt in range(
        1,
        max_retries + 1
    ):

        try:

            print(
                f"Gemini request attempt "
                f"{attempt}/{max_retries}"
            )

            response = (
                gemini_client
                .models
                .generate_content(
                   model="gemini-3.5-flash",
                    contents=prompt
                )
            )

            answer = getattr(
                response,
                "text",
                None
            )

            if answer:

                return answer.strip()

            print(
                "Gemini returned an empty response."
            )

        except Exception as e:

            error_text = str(e)

            print(
                f"Gemini generation error "
                f"(attempt {attempt}): "
                f"{error_text}"
            )

            # ------------------------------------------------
            # RETRY TEMPORARY 503 ERRORS
            # ------------------------------------------------

            temporary_error = (
                "503" in error_text
                or
                "UNAVAILABLE" in error_text
                or
                "high demand" in error_text.lower()
                or
                "temporarily" in error_text.lower()
            )

            if temporary_error:

                if attempt < max_retries:

                    wait_seconds = (
                        2 ** attempt
                    )

                    print(
                        "Gemini is temporarily "
                        "unavailable."
                    )

                    print(
                        f"Retrying in "
                        f"{wait_seconds} seconds..."
                    )

                    time.sleep(
                        wait_seconds
                    )

                    continue

                return (
                    "Gemini is temporarily "
                    "unavailable because the "
                    "model is experiencing high "
                    "demand. The research papers "
                    "were successfully retrieved, "
                    "but Gemini did not respond "
                    "after multiple attempts. "
                    "Please try the question again."
                )

            # ------------------------------------------------
            # OTHER GEMINI ERRORS
            # ------------------------------------------------

            return (
                "Gemini could not generate "
                "the answer. Please check "
                "the backend terminal for "
                "the exact Gemini error."
            )

    return (
        "Gemini returned an empty answer."
    )


# ============================================================
# ROOT ENDPOINT
# ============================================================

@app.get("/")
def root():

    return {
        "message": (
            "Research Paper Assistant "
            "API is running"
        ),
        "status": "online",
        "rag": True,
        "llm": "Gemini"
    }


# ============================================================
# HEALTH CHECK
# ============================================================

@app.get("/health")
def health():

    papers = load_papers()

    return {

        "status": "healthy",

        "papers_loaded": len(papers),

        "gemini_configured": (
            gemini_client is not None
        )

    }


# ============================================================
# GET ALL PDF PAPERS
# ============================================================

@app.get("/papers")
def get_papers():

    papers = []

    pdf_files = sorted(
        PAPERS_DIR.glob("*.pdf"),
        key=lambda p: p.name.lower()
    )

    for pdf_file in pdf_files:

        try:

            reader = PdfReader(
                str(pdf_file)
            )

            page_count = len(
                reader.pages
            )

        except Exception:

            page_count = 0

        try:

            file_size_mb = (
                pdf_file.stat().st_size
                / (1024 * 1024)
            )

        except Exception:

            file_size_mb = 0

        papers.append({

            "filename": pdf_file.name,

            "title": pdf_file.stem,

            "type": "PDF",

            "pages": page_count,

            "size": (
                f"{file_size_mb:.2f} MB"
            )

        })

    return {

        "success": True,

        "count": len(papers),

        "papers": papers

    }


# ============================================================
# ASK QUESTION
# ============================================================

@app.post("/ask")
def ask_question(
    request: QuestionRequest
):

    question = request.question.strip()

    if not question:

        return {

            "answer": (
                "Please enter a question."
            ),

            "source": (
                "Research Paper Assistant"
            ),

            "sources": []

        }

    print(
        f"\nUser question: {question}"
    )

    # --------------------------------------------------------
    # RETRIEVE
    # --------------------------------------------------------

    results = retrieve_relevant_chunks(
        question,
        top_k=12
    )

    print(
        f"Retrieved {len(results)} chunks."
    )

    if not results:

        return {

            "answer": (
                "I could not find relevant "
                "information in the uploaded "
                "research papers."
            ),

            "source": (
                "Research Paper Assistant"
            ),

            "sources": []

        }

    # --------------------------------------------------------
    # GENERATE ANSWER
    # --------------------------------------------------------

    answer = generate_answer(
        question,
        results
    )

    # --------------------------------------------------------
    # PREPARE SOURCES
    # --------------------------------------------------------

    sources = []

    seen = set()

    for result in results:

        key = (
            result["filename"],
            result["page_number"]
        )

        if key in seen:
            continue

        seen.add(key)

        sources.append({

            "filename": result["filename"],

            "page_number": result["page_number"],

            "score": round(
                result["score"],
                3
            )

        })

        if len(sources) >= 12:
            break

    return {

        "answer": answer,

        "source": (
            "Research Paper Assistant "
            "RAG + Gemini"
        ),

        "sources": sources

    }


# ============================================================
# UPLOAD PDF
# ============================================================

@app.post("/upload")
async def upload_pdf(
    file: UploadFile = File(...)
):

    if not file.filename:

        return {

            "success": False,

            "message": (
                "No file selected."
            )

        }

    if not file.filename.lower().endswith(
        ".pdf"
    ):

        return {

            "success": False,

            "message": (
                "Only PDF files are allowed."
            )

        }

    try:

        # ----------------------------------------------------
        # SECURITY:
        # Use only the filename and not any path supplied
        # by the browser.
        # ----------------------------------------------------

        safe_filename = Path(
            file.filename
        ).name

        file_path = (
            PAPERS_DIR /
            safe_filename
        )

        # ----------------------------------------------------
        # SAVE FILE
        # ----------------------------------------------------

        with open(
            file_path,
            "wb"
        ) as buffer:

            shutil.copyfileobj(
                file.file,
                buffer
            )

        # ----------------------------------------------------
        # CHECK PDF
        # ----------------------------------------------------

        reader = PdfReader(
            str(file_path)
        )

        total_pages = len(
            reader.pages
        )

        readable_pages = 0

        total_characters = 0

        for page in reader.pages:

            try:

                text = (
                    page.extract_text()
                    or ""
                )

            except Exception:

                text = ""

            if text.strip():

                readable_pages += 1

                total_characters += len(
                    text
                )

        # ----------------------------------------------------
        # REMOVE EMPTY / IMAGE-ONLY PDF
        # ----------------------------------------------------

        if readable_pages == 0:

            file_path.unlink(
                missing_ok=True
            )

            return {

                "success": False,

                "message": (
                    "The PDF contains "
                    "no readable text. "
                    "If it is a scanned PDF, "
                    "OCR support is required."
                )

            }

        print(
            f"Uploaded PDF: "
            f"{safe_filename}"
        )

        return {

            "success": True,

            "filename": safe_filename,

            "title": Path(
                safe_filename
            ).stem,

            "pages": total_pages,

            "readable_pages": (
                readable_pages
            ),

            "characters": (
                total_characters
            ),

            "message": (
                "PDF uploaded successfully."
            )

        }

    except Exception as e:

        print(
            "Upload error:",
            e
        )

        return {

            "success": False,

            "message": (
                f"Could not process "
                f"the PDF: {e}"
            )

        }


# ============================================================
# DELETE PDF
# ============================================================

@app.delete(
    "/papers/{filename}"
)
def delete_paper(
    filename: str
):

    safe_filename = Path(
        filename
    ).name

    file_path = (
        PAPERS_DIR /
        safe_filename
    )

    if not file_path.exists():

        raise HTTPException(

            status_code=404,

            detail=(
                "PDF not found."
            )

        )

    if file_path.suffix.lower() != ".pdf":

        raise HTTPException(

            status_code=400,

            detail=(
                "Only PDF files "
                "can be deleted."
            )

        )

    try:

        file_path.unlink()

        print(
            f"Deleted PDF: "
            f"{safe_filename}"
        )

        return {

            "success": True,

            "filename": safe_filename,

            "message": (
                f"{safe_filename} "
                "deleted successfully."
            )

        }

    except Exception as e:

        print(
            "Delete error:",
            e
        )

        raise HTTPException(

            status_code=500,

            detail=(
                "Could not delete "
                "the PDF."
            )

        )


# ============================================================
# START SERVER WHEN RUNNING DIRECTLY
# ============================================================

if __name__ == "__main__":

    import uvicorn

    uvicorn.run(

        "main:app",

        host="127.0.0.1",

        port=8000,

        reload=True

    )