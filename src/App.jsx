
import { useEffect, useState } from "react";

import {
  Plus,
  MessageSquare,
  BookOpen,
  GitCompare,
  Search,
  Sparkles,
  Settings,
  PanelLeftClose,
  Menu,
  Paperclip,
  Send,
  FileText,
  MoreHorizontal,
  LogOut,
  ShieldCheck,
} from "lucide-react";

import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "firebase/auth";

import { auth } from "./firebase";

import "./App.css";


/* =========================================================
   BACKEND URL
   ========================================================= */

const BACKEND_URL = "http://127.0.0.1:8000";


/* =========================================================
   LOGIN PAGE
   ========================================================= */

function LoginPage() {

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");


  const loginWithGoogle = async () => {

    try {

      setLoading(true);
      setError("");

      const provider = new GoogleAuthProvider();

      await signInWithPopup(
        auth,
        provider
      );

    } catch (err) {

      console.error(
        "Google sign-in error:",
        err
      );

      setError(
        `${err.code}: ${err.message}`
      );

      setLoading(false);

    }

  };


  return (

    <div className="login-page">

      <div className="login-card">

        <div className="login-logo">
          <Sparkles size={30} />
        </div>


        <h1>
          Research Paper
          <span>Assistant</span>
        </h1>


        <p className="login-description">
          Your AI-powered assistant for understanding,
          comparing, and analyzing research papers.
        </p>


        <button
          className="google-login-button"
          onClick={loginWithGoogle}
          disabled={loading}
        >

          <div className="google-icon">
            G
          </div>

          <span>
            {loading
              ? "Signing in..."
              : "Continue with Google"}
          </span>

        </button>


        <div className="login-security">

          <ShieldCheck size={16} />

          <span>
            Secure authentication powered by Firebase
          </span>

        </div>


        {error && (

          <div className="login-error">
            {error}
          </div>

        )}


        <div className="login-divider">

          <span>
            RESEARCH PAPER ASSISTANT
          </span>

        </div>


        <p className="login-footer">
          Analyze papers • Compare studies •
          Discover research gaps
        </p>

      </div>

    </div>

  );

}


/* =========================================================
   MAIN APPLICATION
   ========================================================= */

function ResearchAssistant({ user }) {

  const [sidebarOpen, setSidebarOpen] =
    useState(true);

  const [message, setMessage] =
    useState("");

  const [messages, setMessages] =
    useState([]);

  const [isLoading, setIsLoading] =
    useState(false);

  const [backendStatus, setBackendStatus] =
    useState("Checking...");

  const [papers, setPapers] =
    useState([]);

  const [papersLoading, setPapersLoading] =
    useState(true);


  /* =========================================================
     CHECK BACKEND
     ========================================================= */

  useEffect(() => {

    fetch(
      `${BACKEND_URL}/health`
    )

      .then((response) => {

        if (!response.ok) {

          throw new Error(
            "Backend unavailable"
          );

        }

        return response.json();

      })

      .then((data) => {

        setBackendStatus(
          data.status || "healthy"
        );

      })

      .catch((error) => {

        console.error(
          "Backend health error:",
          error
        );

        setBackendStatus(
          "Backend unavailable"
        );

      });

  }, []);


  /* =========================================================
     LOAD PAPERS FROM BACKEND
     ========================================================= */

  const loadPapers = async () => {

    try {

      setPapersLoading(true);

      const response = await fetch(
        `${BACKEND_URL}/papers`
      );

      if (!response.ok) {

        throw new Error(
          `Paper loading failed: ${response.status}`
        );

      }

      const data =
        await response.json();


      console.log(
        "Papers from backend:",
        data
      );


      if (data.success) {

        setPapers(
          Array.isArray(data.papers)
            ? data.papers.map(
                (paper, index) => ({
                  ...paper,

                  id:
                    paper.filename ||
                    `paper-${index}`
                })
              )
            : []
        );

      } else {

        setPapers([]);

      }

    } catch (error) {

      console.error(
        "Could not load papers:",
        error
      );

      setPapers([]);

    } finally {

      setPapersLoading(false);

    }

  };


  /* =========================================================
     LOAD PAPERS WHEN APP OPENS
     ========================================================= */

  useEffect(() => {

    loadPapers();

  }, []);


  /* =========================================================
     SEND MESSAGE
     ========================================================= */

  const sendMessage = async () => {

    if (
      !message.trim() ||
      isLoading
    ) {

      return;

    }


    const question =
      message.trim();


    /* -------------------------------------------------------
       Add user question
       ------------------------------------------------------- */

    setMessages(
      (previous) => [

        ...previous,

        {
          role: "user",
          content: question,
        },

      ]
    );


    setMessage("");

    setIsLoading(true);


    try {

      const response = await fetch(
        `${BACKEND_URL}/ask`,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            question: question,
          }),

        }
      );


      if (!response.ok) {

        throw new Error(
          `Backend error: ${response.status}`
        );

      }


      const data =
        await response.json();


      console.log(
        "Ask response:",
        data
      );


      /* -------------------------------------------------------
         Add assistant answer
         ------------------------------------------------------- */

      setMessages(
        (previous) => [

          ...previous,

          {
            role: "assistant",

            content:
              data.answer ||
              "No answer received from the backend.",

            sources:
              data.sources || [],
          },

        ]
      );


    } catch (error) {

      console.error(
        "Error asking question:",
        error
      );


      setMessages(
        (previous) => [

          ...previous,

          {
            role: "assistant",

            content:
              "Sorry, I could not connect to the Research Paper Assistant backend.",

            sources: [],
          },

        ]
      );


    } finally {

      setIsLoading(false);

    }

  };


  /* =========================================================
     UPLOAD PDF
     ========================================================= */

  const uploadPDF = async (event) => {

    const file =
      event.target.files?.[0];


    if (!file) {

      return;

    }


    if (
      !file.name
        .toLowerCase()
        .endsWith(".pdf")
    ) {

      alert(
        "Please select a PDF file."
      );

      event.target.value = "";

      return;

    }


    const formData =
      new FormData();


    formData.append(
      "file",
      file
    );


    try {

      setPapersLoading(true);


      const response =
        await fetch(
          `${BACKEND_URL}/upload`,
          {
            method: "POST",
            body: formData,
          }
        );


      const data =
        await response.json();


      console.log(
        "Upload response:",
        data
      );


      if (!response.ok) {

        throw new Error(
          data.message ||
          `Upload failed: ${response.status}`
        );

      }


      if (data.success) {

        /*
         * Reload the complete list from backend.
         * This prevents duplicate or incorrect
         * frontend-only paper entries.
         */

        await loadPapers();


        alert(
          `${data.filename} uploaded successfully.`
        );

      } else {

        alert(
          data.message ||
          "PDF upload failed."
        );

      }

    } catch (error) {

      console.error(
        "Upload error:",
        error
      );


      alert(
        `Could not upload PDF: ${error.message}`
      );

    } finally {

      setPapersLoading(false);

      /*
       * Allow selecting the same file again.
       */

      event.target.value = "";

    }

  };


  /* =========================================================
     DELETE PDF
     ========================================================= */

  const deletePDF = async (paper) => {

    if (!paper?.filename) {

      return;

    }


    const confirmed =
      window.confirm(
        `Delete "${paper.filename}"?`
      );


    if (!confirmed) {

      return;

    }


    try {

      const response =
        await fetch(
          `${BACKEND_URL}/papers/${encodeURIComponent(
            paper.filename
          )}`,
          {
            method: "DELETE",
          }
        );


      const data =
        await response.json();


      console.log(
        "Delete response:",
        data
      );


      if (!response.ok) {

        throw new Error(
          data.detail ||
          data.message ||
          `Delete failed: ${response.status}`
        );

      }


      if (data.success) {

        /*
         * Remove from UI immediately.
         */

        setPapers(
          (previous) =>
            previous.filter(
              (item) =>
                item.filename !==
                paper.filename
            )
        );


        alert(
          `${paper.filename} deleted successfully.`
        );

      } else {

        alert(
          data.message ||
          "Could not delete the PDF."
        );

      }

    } catch (error) {

      console.error(
        "Delete error:",
        error
      );


      alert(
        `Could not delete PDF: ${error.message}`
      );

    }

  };


  /* =========================================================
     LOGOUT
     ========================================================= */

  const logout = async () => {

    try {

      await signOut(auth);

    } catch (error) {

      console.error(
        "Logout failed:",
        error
      );

    }

  };


  /* =========================================================
     UI
     ========================================================= */

  return (

    <div className="app">


      {/* =================================================
          SIDEBAR
          ================================================= */}

      <aside
        className={`sidebar ${
          sidebarOpen
            ? "open"
            : "closed"
        }`}
      >


        {/* Sidebar Header */}

        <div className="sidebar-header">

          <div className="brand">

            <div className="brand-icon">
              <Sparkles size={19} />
            </div>


            {sidebarOpen && (

              <div className="brand-name">

                <strong>
                  Research Paper
                </strong>

                <span>
                  Assistant
                </span>

              </div>

            )}

          </div>


          {sidebarOpen && (

            <button
              className="icon-button"
              onClick={() =>
                setSidebarOpen(false)
              }
              title="Close sidebar"
            >

              <PanelLeftClose
                size={19}
              />

            </button>

          )}

        </div>


        {/* =================================================
            NEW CHAT
            ================================================= */}

        <button
          className="new-chat"
          onClick={() =>
            setMessages([])
          }
        >

          <Plus size={19} />

          {sidebarOpen && (

            <span>
              New Chat
            </span>

          )}

        </button>


        {/* =================================================
            NAVIGATION
            ================================================= */}

        <div className="navigation">

          {sidebarOpen && (

            <p className="section-title">
              WORKSPACE
            </p>

          )}


          <button
            className="nav-item active"
          >

            <MessageSquare size={18} />

            {sidebarOpen && (

              <span>
                Research Chat
              </span>

            )}

          </button>


          <button
            className="nav-item"
          >

            <BookOpen size={18} />

            {sidebarOpen && (

              <>

                <span>
                  My Papers
                </span>

                <small>
                  {papers.length}
                </small>

              </>

            )}

          </button>


          <button
            className="nav-item"
          >

            <Search size={18} />

            {sidebarOpen && (

              <span>
                Literature Search
              </span>

            )}

          </button>


          <button
            className="nav-item"
          >

            <GitCompare size={18} />

            {sidebarOpen && (

              <span>
                Compare Papers
              </span>

            )}

          </button>


          <button
            className="nav-item"
          >

            <Sparkles size={18} />

            {sidebarOpen && (

              <span>
                Research Gaps
              </span>

            )}

          </button>

        </div>


        {/* =================================================
            RECENT PAPERS
            ================================================= */}

        {sidebarOpen && (

          <div className="recent-section">

            <p className="section-title">
              RECENT PAPERS
            </p>


            {papersLoading ? (

              <div className="recent-paper">

                <FileText size={16} />

                <span>
                  Loading papers...
                </span>

              </div>

            ) : papers.length === 0 ? (

              <div className="recent-paper">

                <FileText size={16} />

                <span>
                  No papers uploaded
                </span>

              </div>

            ) : (

              papers.map(
                (paper) => (

                  <button
                    className="recent-paper"
                    key={paper.id}
                    title={paper.filename}
                  >

                    <FileText size={16} />

                    <span>
                      {paper.filename}
                    </span>

                  </button>

                )
              )

            )}

          </div>

        )}


        {/* =================================================
            SIDEBAR BOTTOM
            ================================================= */}

        <div className="sidebar-bottom">

          <button
            className="nav-item"
          >

            <Settings size={18} />

            {sidebarOpen && (

              <span>
                Settings
              </span>

            )}

          </button>


          {/* Profile */}

          <div className="profile">


            {/* Profile Image */}

            {user.photoURL ? (

              <img
                className="profile-avatar-image"
                src={user.photoURL}
                alt="Profile"
                referrerPolicy="no-referrer"
              />

            ) : (

              <div className="profile-avatar">

                {user.displayName
                  ?.charAt(0)
                  ?.toUpperCase() ||
                  "U"}

              </div>

            )}


            {sidebarOpen && (

              <div className="profile-info">

                <strong>

                  {user.displayName ||
                    "Researcher"}

                </strong>

                <span>

                  {user.email}

                </span>

              </div>

            )}


            {sidebarOpen && (

              <button
                className="logout-button"
                onClick={logout}
                title="Sign out"
              >

                <LogOut size={17} />

              </button>

            )}

          </div>

        </div>

      </aside>


      {/* =================================================
          OPEN SIDEBAR BUTTON
          ================================================= */}

      {!sidebarOpen && (

        <button
          className="menu-button"
          onClick={() =>
            setSidebarOpen(true)
          }
          title="Open sidebar"
        >

          <Menu size={20} />

        </button>

      )}


      {/* =================================================
          MAIN
          ================================================= */}

      <main className="main">


        {/* =================================================
            TOPBAR
            ================================================= */}

        <header className="topbar">

          <div>

            <h2>
              Research Chat
            </h2>

            <span>

              {papers.length} research
              {papers.length === 1
                ? " paper"
                : " papers"}{" "}
              available

            </span>

          </div>


          <button
            className="model-button"
          >

            <Sparkles size={16} />

            Research Assistant

          </button>

        </header>


        {/* =================================================
            CHAT AREA
            ================================================= */}

        <section className="chat-area">


          {/* =================================================
              WELCOME
              ================================================= */}

          {messages.length === 0 && (

            <div className="welcome">

              <div className="welcome-icon">
                <Sparkles size={28} />
              </div>


              <h1>

                What would you like to

                <br />

                <span>
                  research today?
                </span>

              </h1>


              <p>

                Ask questions about your research
                papers, compare studies, extract
                methodologies, and discover
                research gaps.

              </p>

            </div>

          )}


          {/* =================================================
              SUGGESTIONS
              ================================================= */}

          {messages.length === 0 && (

            <div className="suggestions">


              <button
                onClick={() =>
                  setMessage(
                    "What are the datasets used in these papers?"
                  )
                }
              >

                <BookOpen size={18} />

                <div>

                  <strong>
                    Extract datasets
                  </strong>

                  <span>
                    Identify datasets used
                    in the papers
                  </span>

                </div>

              </button>


              <button
                onClick={() =>
                  setMessage(
                    "What are the methodologies used in these papers?"
                  )
                }
              >

                <BookOpen size={18} />

                <div>

                  <strong>
                    Extract methodology
                  </strong>

                  <span>
                    Identify methods used
                    in the papers
                  </span>

                </div>

              </button>


              <button
                onClick={() =>
                  setMessage(
                    "Compare the methodologies of these papers"
                  )
                }
              >

                <GitCompare size={18} />

                <div>

                  <strong>
                    Compare papers
                  </strong>

                  <span>
                    Compare approaches
                    and results
                  </span>

                </div>

              </button>


              <button
                onClick={() =>
                  setMessage(
                    "What are the research gaps?"
                  )
                }
              >

                <Sparkles size={18} />

                <div>

                  <strong>
                    Find research gaps
                  </strong>

                  <span>
                    Discover unexplored
                    areas
                  </span>

                </div>

              </button>


            </div>

          )}


          {/* =================================================
              CHAT MESSAGES
              ================================================= */}

          {messages.length > 0 && (

            <div className="chat-messages">

              {messages.map(
                (msg, index) => (

                  <div
                    key={index}
                    className={`chat-message ${
                      msg.role === "user"
                        ? "user-message"
                        : "assistant-message"
                    }`}
                  >

                    <div className="message-role">

                      {msg.role === "user"
                        ? "You"
                        : "Research Assistant"}

                    </div>


                    <div className="message-content">

                      {msg.content}

                    </div>


                    {/* =================================================
                        SOURCES
                        ================================================= */}

                    {msg.role === "assistant" &&
                      msg.sources &&
                      msg.sources.length > 0 && (

                        <div className="message-sources">

                          <div className="sources-title">

                            Sources

                          </div>


                          {msg.sources.map(
                            (
                              source,
                              sourceIndex
                            ) => (

                              <div
                                className="source-card"
                                key={
                                  `${source.filename}-${source.page_number}-${sourceIndex}`
                                }
                              >

                                <div>

                                  📄{" "}

                                  <strong>
                                    {source.filename}
                                  </strong>

                                </div>


                                <div className="source-details">

                                  Page{" "}

                                  {source.page_number ||
                                    "Unknown"}

                                  {" • "}

                                  Relevance:{" "}

                                  {Number(
                                    source.score || 0
                                  ).toFixed(3)}

                                </div>

                              </div>

                            )
                          )}

                        </div>

                      )}

                  </div>

                )
              )}


              {/* Loading */}

              {isLoading && (

                <div className="chat-message assistant-message">

                  <div className="message-role">

                    Research Assistant

                  </div>

                  <div className="message-content">

                    Searching your research papers...

                  </div>

                </div>

              )}

            </div>

          )}


          {/* =================================================
              PAPERS AREA
              ================================================= */}

          {messages.length === 0 && (

            <div className="papers-area">


              <div className="papers-heading">

                <div>

                  <h3>
                    Your Research Papers
                  </h3>

                  <span>
                    {papers.length}{" "}
                    {papers.length === 1
                      ? "paper"
                      : "papers"}{" "}
                    available
                  </span>

                </div>


                {/* =================================================
                    UPLOAD INPUT
                    ================================================= */}

                <input
                  type="file"
                  id="pdf-upload"
                  accept=".pdf,application/pdf"
                  style={{
                    display: "none",
                  }}
                  onChange={uploadPDF}
                />


                <label
                  htmlFor="pdf-upload"
                  className="upload-small"
                  style={{
                    cursor: "pointer",
                  }}
                >

                  <Paperclip size={16} />

                  Upload PDF

                </label>

              </div>


              {/* =================================================
                  PAPER GRID
                  ================================================= */}

              <div className="paper-grid">


                {papersLoading ? (

                  <div className="paper-card">

                    <div className="paper-icon">

                      <FileText
                        size={22}
                      />

                    </div>

                    <div className="paper-content">

                      <h4>
                        Loading papers...
                      </h4>

                    </div>

                  </div>

                ) : papers.length === 0 ? (

                  <div className="paper-card">

                    <div className="paper-icon">

                      <FileText
                        size={22}
                      />

                    </div>

                    <div className="paper-content">

                      <h4>
                        No PDF papers uploaded
                      </h4>

                      <div className="paper-meta">

                        <span>
                          Click "Upload PDF"
                          to add a paper.
                        </span>

                      </div>

                    </div>

                  </div>

                ) : (

                  papers.map(
                    (paper) => (

                      <div
                        className="paper-card"
                        key={paper.id}
                      >


                        <div className="paper-icon">

                          <FileText
                            size={22}
                          />

                        </div>


                        <div className="paper-content">

                          <h4
                            title={paper.filename}
                          >

                            {paper.filename}

                          </h4>


                          <div className="paper-meta">

                            <span>
                              PDF
                            </span>

                            <span>
                              •
                            </span>

                            <span>
                              {paper.size ||
                                "Unknown size"}
                            </span>

                            {paper.pages > 0 && (

                              <>

                                <span>
                                  •
                                </span>

                                <span>
                                  {paper.pages}{" "}
                                  pages
                                </span>

                              </>

                            )}

                          </div>

                        </div>


                        {/* =================================================
                            DELETE
                            ================================================= */}

                        <button
                          className="card-menu"
                          onClick={() =>
                            deletePDF(paper)
                          }
                          title="Delete PDF"
                        >

                          <MoreHorizontal
                            size={18}
                          />

                        </button>

                      </div>

                    )
                  )

                )}

              </div>

            </div>

          )}

        </section>


        {/* =================================================
            INPUT SECTION
            ================================================= */}

        <div className="input-section">

          <div className="input-box">


            <button
              className="attach-button"
              type="button"
              onClick={() =>
                document
                  .getElementById(
                    "pdf-upload"
                  )
                  ?.click()
              }
              title="Upload PDF"
            >

              <Paperclip size={20} />

            </button>


            <textarea

              value={message}

              onChange={(e) =>
                setMessage(
                  e.target.value
                )
              }


              onKeyDown={(e) => {

                if (
                  e.key === "Enter" &&
                  !e.shiftKey
                ) {

                  e.preventDefault();

                  sendMessage();

                }

              }}


              placeholder="Ask anything about your research papers..."

              rows="1"

              disabled={isLoading}

            />


            <button
              className="send-button"
              onClick={sendMessage}
              disabled={
                isLoading ||
                !message.trim()
              }
              title="Send"
            >

              <Send size={18} />

            </button>

          </div>


          <p className="input-note">

            Research Paper Assistant can make
            mistakes. Always verify important
            research information.

          </p>

        </div>


      </main>

    </div>

  );

}


/* =========================================================
   APP
   ========================================================= */

function App() {

  const [user, setUser] =
    useState(null);

  const [checkingAuth, setCheckingAuth] =
    useState(true);


  useEffect(() => {

    const unsubscribe =
      onAuthStateChanged(
        auth,
        (currentUser) => {

          setUser(
            currentUser
          );

          setCheckingAuth(
            false
          );

        }
      );


    return () =>
      unsubscribe();

  }, []);


  if (checkingAuth) {

    return (

      <div className="auth-loading">

        Checking authentication...

      </div>

    );

  }


  if (!user) {

    return <LoginPage />;

  }


  return (

    <ResearchAssistant
      user={user}
    />

  );

}


export default App;

