# Smart Resume Screener

This is a local Node.js backend application designed to automate resume screening. It takes a candidate's resume (PDF), extracts the core information, and scores it against a provided job description to generate a quick hiring recommendation. 

I built this to handle messy, multi-column resume layouts by parsing the raw text and using an LLM to evaluate the match percentage accurately.

## Tech Stack
* **Backend:** Node.js, Express.js
* **Database:** SQLite (local storage for evaluations)
* **File Parsing:** pdf2json
* **AI Engine:** Google Gemini API 

## How to Run it Locally

To get this running on your local machine, follow these steps:

1. Clone the repository:
   ```bash
   git clone [https://github.com/Tanmaikiran/smart-resume-screener.git](https://github.com/Tanmaikiran/smart-resume-screener.git)
   ```

2. Navigate into the project folder and install the required dependencies:
   ```bash
   npm install
   ```

3. Start the local server:
   ```bash
   node index.js
   ```

4. Once the terminal says the server is running, open your web browser and go to:
   `http://localhost:3001`

Upload a PDF resume, paste a job description into the text area, and click generate to see the match results.
