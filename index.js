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
    return cleanText.replace(/\s+/g, ' ').trim();
}

// 100% Local, Precision-Targeted Extraction
function extractResumeData(text) {
    const lowerText = text.toLowerCase();
    
    // 1. SKILLS
    const knownSkills = [
        'javascript', 'java', 'python', 'c', 'c++', 'html', 'css', 
        'node.js', 'express', 'react', 'sql', 'mysql', 'mongodb', 
        'postgresql', 'redis', 'docker', 'kubernetes', 'git', 'github', 
        'three.js', 'laravel', 'firebase', 'aws', 'jwt', 'oauth'
    ];
    const skills = knownSkills.filter(skill => lowerText.includes(skill.toLowerCase()));

    // Clean text to stop URL bleed
    const cleanText = text.replace(/https?:\/\/[^\s]+/g, '').replace(/GITHUB LINK|LIVE APP LINK/ig, '').replace(/\s+/g, ' ');

    // 2. EDUCATION: Extracts ONLY Degree, University, Year, and CGPA
    let eduParts = [];
    const degree = cleanText.match(/(B\.?Tech(?: in [a-zA-Z\s]+)?|Bachelor(?:'s)?(?: of [a-zA-Z\s]+)?|M\.?Tech|Master(?:'s)?)/i);
    const university = cleanText.match(/([A-Z][a-zA-Z\s]+(?:University|Institute of Technology|College|Institutions))/);
    const year = cleanText.match(/(20\d{2}\s*[-–]\s*20\d{2})/);
    const cgpa = cleanText.match(/(CGPA[\s:]*\d\.\d{1,2})/i);

    if (degree) eduParts.push(degree[1].trim());
    if (university) eduParts.push(university[1].trim());
    if (year) eduParts.push(year[1].trim());
    if (cgpa) eduParts.push(cgpa[1].trim());
    
    const education = eduParts.length > 0 ? eduParts.join(' | ') : "Education details not clearly identified.";

    // 3. EXPERIENCE: Extracts ONLY Role and Action Sentences
    let expParts = [];
    const role = cleanText.match(/(Software Engineer|Developer|Intern|Co-founder|Founder|Student Startup)[^,\.]{0,30}/i);
    if (role) expParts.push(role[1].trim());
    
    const action = cleanText.match(/(Developed|Built|Led|Implemented)[a-zA-Z\s0-9]{10,70}(?:using [a-zA-Z0-9\s]+)?/i);
    if (action) expParts.push(action[0].trim());

    const experience = expParts.length > 0 ? expParts.join(' | ') : "Experience details not clearly identified.";

    return { skills, experience, education };
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
            return res.status(400).json({ error: 'No readable text was found.' });
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