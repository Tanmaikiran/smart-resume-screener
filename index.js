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
    return cleanText.replace(/\s+/g, ' ').replace(/\s+([,.])/g, '$1').trim();
}

function extractResumeData(text) {
    const lowerText = text.toLowerCase();
    const knownSkills = [
        'javascript', 'java', 'python', 'c', 'c++', 'html', 'css', 
        'node.js', 'nodejs', 'express', 'react', 'sql', 'mysql', 
        'mongodb', 'postgresql', 'redis', 'docker', 'kubernetes', 
        'git', 'github', 'three.js', 'laravel', 'firebase', 'aws', 
        'azure', 'web3.js', 'jwt', 'oauth', 'rest api', 'api'
    ];
    
    const skills = knownSkills.filter(skill => lowerText.includes(skill.toLowerCase()));
    
    // Updated regex to stop at newlines and limit the character grab length
    const educationMatch = text.match(/(B\.?Tech|Bachelor|Engineering|Computer Science|M\.?Tech|Master)[^.\n]{0,100}/i);
    const experienceMatch = text.match(/(work experience|experience|internship|developer|engineer|developed|built|implemented)[^.\n]{0,200}/i);

    return {
        skills,
        experience: experienceMatch ? experienceMatch[0].trim() : 'Not clearly identified',
        education: educationMatch ? educationMatch[0].trim() : 'Not clearly identified'
    };
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

    pdfParser.on('pdfParser_dataReady', () => {
        let extractedText = pdfParser.getRawTextContent();
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

        if (!extractedText || extractedText.trim() === '') {
            return res.status(400).json({ error: 'No readable text was found in the resume.' });
        }

        extractedText = cleanPdfText(extractedText);
        const resumeData = extractResumeData(extractedText);

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

    const prompt = `You are a technical recruiter evaluating a candidate resume against a job description.

SCORING RULE:
80-100 = SHORTLIST
60-79 = REVIEW
0-59 = REJECT

Return ONLY the following exact format:
MATCH SCORE: <number from 0 to 100>
DECISION: <SHORTLIST, REVIEW, or REJECT>
SKILLS MATCH: <one sentence explaining technical skill overlap>
EXPERIENCE MATCH: <one sentence explaining relevant projects>
EDUCATION MATCH: <one sentence explaining education relevance>
JUSTIFICATION: <two sentences summarizing the technical fit>

Candidate Resume:
${resumeText}

Job Description:
${jobDescription}`;

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${API_KEY}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: prompt }]
                }],
                generationConfig: {
                    maxOutputTokens: 1000,
                    temperature: 0.2
                }
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error?.message || "Direct API call failed");
        }

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