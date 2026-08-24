const express = require('express');
const cors = require('cors');
const multer = require('multer');
const PDFParser = require('pdf2json');
const fs = require('fs');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3001;
const uploadFolder = path.join(__dirname, 'uploads');

if (!fs.existsSync(uploadFolder)) {
    fs.mkdirSync(uploadFolder);
}

const upload = multer({ dest: uploadFolder });

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const API_KEY = "AQ.Ab8RN6Jeq3OB" + "5XVE-d-YecZ7-vsXs7SN49ZWXOvPxDZIMoxG9g";

function cleanPdfText(text) {
    let cleanText = text;
    try { cleanText = decodeURIComponent(text); } catch (error) {}
    return cleanText.replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n').trim();
}

async function extractResumeDataWithAI(rawText) {
    const prompt = `Extract data from this resume text. Fix any formatting issues caused by column layouts.
Return EXACTLY this JSON structure and nothing else:
{"skills":["skill1","skill2"],"education":"Clean summary of degrees and universities","experience":"Clean summary of work and projects"}

Resume Text:
${rawText.substring(0, 3000)}`;

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.0, // Zero creativity = max speed and precision
                    maxOutputTokens: 300, // Forces a short, fast response
                    responseMimeType: "application/json" // Forces strict JSON output
                }
            })
        });

        const data = await response.json();
        if (response.ok && data.candidates && data.candidates[0]?.content?.parts[0]?.text) {
            const parsed = JSON.parse(data.candidates[0].content.parts[0].text);
            return {
                skills: Array.isArray(parsed.skills) ? parsed.skills : [],
                education: parsed.education || 'Not clearly identified',
                experience: parsed.experience || 'Not clearly identified'
            };
        }
    } catch (err) {
        console.error("AI extraction error:", err.message);
    }

    return { skills: [], education: 'Extraction failed.', experience: 'Extraction failed.' };
}

app.post('/upload', upload.single('resume'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Please upload a resume file.' });

    const filePath = req.file.path;
    const originalName = req.file.originalname;
    const pdfParser = new PDFParser(null, 1);

    pdfParser.on('pdfParser_dataError', error => {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        return res.status(500).json({ error: 'Failed to read the PDF file.' });
    });

    pdfParser.on('pdfParser_dataReady', async () => {
        let extractedText = pdfParser.getRawTextContent();
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

        if (!extractedText || extractedText.trim() === '') {
            return res.status(400).json({ error: 'No readable text was found.' });
        }

        extractedText = cleanPdfText(extractedText);
        const resumeData = await extractResumeDataWithAI(extractedText);

        const result = db.prepare(`
            INSERT INTO resumes (file_name, resume_text, skills, experience, education)
            VALUES (?, ?, ?, ?, ?)
        `).run(originalName, extractedText, JSON.stringify(resumeData.skills), resumeData.experience, resumeData.education);

        return res.json({
            resumeId: result.lastInsertRowid,
            text: extractedText,
            skills: resumeData.skills,
            experience: resumeData.experience,
            education: resumeData.education
        });
    });

    pdfParser.loadPDF(filePath);
});

app.post('/score', async (req, res) => {
    const { resumeId, resumeText, jobDescription } = req.body;

    if (!resumeText || !jobDescription) {
        return res.status(400).json({ error: 'Resume text and job description are required.' });
    }

    const prompt = `Act as an expert recruiter. Compare the resume to the job description.
Return EXACTLY this text format, with no markdown, asterisks, or extra spaces:
MATCH SCORE: [Number 0-100]
DECISION: [SHORTLIST, REVIEW, or REJECT]
SKILLS MATCH: [1 sentence]
EXPERIENCE MATCH: [1 sentence]
EDUCATION MATCH: [1 sentence]
JUSTIFICATION: [1 sentence]

Resume:
${resumeText.substring(0, 3000)}

Job Description:
${jobDescription}`;

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    maxOutputTokens: 250,
                    temperature: 0.1
                }
            })
        });

        const data = await response.json();

        if (!response.ok) throw new Error(data.error?.message || "Direct API call failed");

        const matchResult = data.candidates[0].content.parts[0].text;
        const scoreMatch = matchResult.match(/MATCH SCORE:\s*(\d+)/i);
        const decisionMatch = matchResult.match(/DECISION:\s*(SHORTLIST|REVIEW|REJECT)/i);
        
        const matchScore = scoreMatch ? parseInt(scoreMatch[1]) : 0;
        const decision = decisionMatch ? decisionMatch[1].toUpperCase() : 'REVIEW';

        if (resumeId) {
            db.prepare(`
                INSERT INTO evaluations (resume_id, job_description, match_score, decision, justification)
                VALUES (?, ?, ?, ?, ?)
            `).run(resumeId, jobDescription, matchScore, decision, matchResult);
        }

        return res.json({ matchScore, decision, matchResult });
    } catch (error) {
        return res.status(500).json({ error: 'API Error: ' + error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});