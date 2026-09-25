const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');

const app = express();
const PORT = 3000;

if (!fs.existsSync('./uploads')) {
    fs.mkdirSync('./uploads');
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname))
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }
});

app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static('uploads'));

app.use(session({
    secret: 'mwu-full-system-session-fix',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 3600000 }
}));

const ADMIN_USER = "amanuel";
const ADMIN_PASS = "1234";

function generateStudentID() {
    return `MWU-${Math.floor(1000 + Math.random() * 9000)}`;
}

function generate4DigitPIN() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

let teacherAccounts = {
    "T-101": { id: "T-101", name: "Dr. Teshale Kebede", dept: "Statistics", pass: "123456", phone: "0911001122", assigned_section: "1st Year - Section A" },
    "T-102": { id: "T-102", name: "Abebech Bekele", dept: "Computer Science", pass: "123456", phone: "0922334455", assigned_section: "1st Year - Section B" }
};

let studentAccounts = {}; 
let studentData = {};     
let pendingStudents = []; 
let withdrawalRequests = [];
let studentAssessments = {}; // Stores student grades/assessments { student_id: { quiz, mid, final, total, remark } }

let sectionMonitors = {
    "1st Year - Section A": { name: "Kefyalew Kebede (Monitor)", phone: "0912345678" },
    "1st Year - Section B": { name: "Chala Tesfaye (Monitor)", phone: "0987654321" }
};

function assignClassSection(requestedYearLevel) {
    const letters = ["A", "B", "C", "D", "E", "F", "G"];
    for (let i = 0; i < letters.length; i++) {
        let secName = `${requestedYearLevel} - Section ${letters[i]}`;
        let currentCount = Object.values(studentData).filter(s => s.class_level === secName).length;
        let pendingCount = pendingStudents.filter(s => s.class_level === secName).length;
        if ((currentCount + pendingCount) < 50) {
            return secName;
        }
    }
    return `${requestedYearLevel} - Section Overflow`;
}

// LANDING PAGE
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="am">
    <head>
        <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>MWU Digital Portal</title>
        <style>
            * { box-sizing: border-box; font-family: sans-serif; }
            body { background-color: #f4f7f6; margin: 0; padding: 20px; font-size: 18px; }
            .container { max-width: 480px; margin: 0 auto; text-align: center; background: white; padding: 30px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); }
            h2 { font-size: 24px; color: #1f4e79; margin-bottom:20px; }
            select, input { width: 100%; padding: 14px; margin-bottom: 15px; border: 1px solid #ccc; border-radius: 8px; font-size: 16px; }
            .btn-login { width: 100%; padding: 14px; background: #1f4e79; color: white; border: none; border-radius: 8px; font-size: 18px; font-weight: bold; cursor: pointer; }
            .btn-register { display: block; margin-top: 15px; background: #27ae60; color: white; text-decoration: none; padding: 12px; border-radius: 8px; font-weight: bold; font-size: 16px; }
        </style>
    </head>
    <body>
        <div class="container">
            <h2>🎓 MWU DIGITAL PORTAL</h2>
            <form action="/login" method="POST">
                <select name="role">
                    <option value="student">🎓 ተማሪ (Student Login)</option>
                    <option value="teacher">👨‍🏫 መምህር (Teacher Login)</option>
                    <option value="admin">🔐 አድሚን (Admin Login)</option>
                </select>
                <input type="text" name="username" placeholder="ID Number (e.g. MWU-1001 or T-101)" required>
                <input type="password" name="password" placeholder="Password PIN" required>
                <button type="submit" class="btn-login">Log In</button>
            </form>
            <hr style="margin-top:20px;">
            <a href="/student-register" class="btn-register">📝 አዲስ ተማሪ ምዝገባ (Self Register)</a>
        </div>
    </body>
    </html>
    `);
});

// STUDENT REGISTRATION FORM
app.get('/student-register', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="am">
    <head>
        <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Student Registration</title>
        <style>
            body { font-family: sans-serif; background: #eef2f5; padding: 15px; font-size: 16px; }
            .container { max-width: 600px; margin: 0 auto; background: white; padding: 25px; border-radius: 12px; }
            h2 { font-size: 22px; text-align: center; color: #1f4e79; }
            input, select { width: 100%; padding: 10px; margin-top: 4px; margin-bottom: 12px; border: 1px solid #ccc; border-radius: 6px; box-sizing: border-box; }
            label { font-weight: bold; font-size: 14px; }
            .row { display: flex; gap: 10px; }
            .col { flex: 1; }
            .btn-submit { background: #27ae60; color: white; border: none; padding: 14px; width: 100%; margin-top: 15px; border-radius: 8px; font-weight: bold; font-size: 17px; cursor: pointer; }
        </style>
    </head>
    <body>
        <div class="container">
            <h2>📝 ሙሉ የተማሪዎች ምዝገባ ፎርም</h2>
            <form action="/api/student-self-register" method="POST" enctype="multipart/form-data">
                <label>ሙሉ ስም (Full Name):</label>
                <input type="text" name="name" required>
                <div class="row">
                    <div class="col"><label>የአባት ስም:</label><input type="text" name="father_name" required></div>
                    <div class="col"><label>የእናት ስም:</label><input type="text" name="mother_name" required></div>
                </div>
                <div class="row">
                    <div class="col">
                        <label>ጾታ (Gender):</label>
                        <select name="gender"><option value="Male">Male</option><option value="Female">Female</option></select>
                    </div>
                    <div class="col"><label>ዕድሜ (Age):</label><input type="number" name="age" required></div>
                </div>
                <div class="row">
                    <div class="col"><label>ስልክ ቁጥር (Phone):</label><input type="text" name="phone" required></div>
                    <div class="col"><label>የአደጋ ጊዜ ተጠሪ ስልክ:</label><input type="text" name="emergency_phone" required></div>
                </div>
                <div class="row">
                    <div class="col"><label>ክልል (Region):</label><input type="text" name="region" required></div>
                    <div class="col"><label>ዞን (Zone):</label><input type="text" name="zone" required></div>
                </div>
                <div class="row">
                    <div class="col"><label>ወረዳ (Woreda):</label><input type="text" name="woreda" required></div>
                    <div class="col"><label>ቀበሌ (Kebele):</label><input type="text" name="kebele" required></div>
                </div>
                <label>ትምህርት ክፍል (Department):</label>
                <input type="text" name="department" required>
                <label>Academic Year Level:</label>
                <select name="year_level">
                    <option value="1st Year">1st Year</option>
                    <option value="2nd Year">2nd Year</option>
                    <option value="3rd Year">3rd Year</option>
                    <option value="4th Year">4th Year</option>
                </select>
                <label>የተማሪው ጉርድ ፎቶ (Passport Photo):</label>
                <input type="file" name="student_photo" accept="image/*" required>
                <label>የክፍያ ማረጋገጫ አይነት:</label>
                <select name="payment_type" id="payType" onchange="togglePay()">
                    <option value="txn_id">የትራንዛክሽን ቁጥር (Txn Ref)</option>
                    <option value="slip_file">የደረሰኝ ፎቶ/PDF ማያያዝ</option>
                </select>
                <div id="txnBox">
                    <label>Transaction ID / Ref Number:</label>
                    <input type="text" name="txn_id" placeholder="e.g. FT240981123">
                </div>
                <div id="slipBox" style="display:none;">
                    <label>Bank Slip Document (Image/PDF):</label>
                    <input type="file" name="bank_slip_file" accept="image/*,.pdf">
                </div>
                <button type="submit" class="btn-submit">🚀 ምዝገባውን ለአድሚን ላክ</button>
            </form>
        </div>
        <script>
            function togglePay() {
                var val = document.getElementById('payType').value;
                document.getElementById('txnBox').style.display = val === 'txn_id' ? 'block' : 'none';
                document.getElementById('slipBox').style.display = val === 'slip_file' ? 'block' : 'none';
            }
        </script>
    </body>
    </html>
    `);
});

const registerUpload = upload.fields([
    { name: 'student_photo', maxCount: 1 },
    { name: 'bank_slip_file', maxCount: 1 }
]);

app.post('/api/student-self-register', registerUpload, (req, res) => {
    const { name, father_name, mother_name, gender, age, phone, emergency_phone, region, zone, woreda, kebele, department, year_level, payment_type, txn_id } = req.body;

    let autoID = generateStudentID();
    let autoPIN = generate4DigitPIN();
    let assignedSection = assignClassSection(year_level);

    let photoPath = req.files && req.files['student_photo'] ? req.files['student_photo'][0].filename : '';
    let slipPath = payment_type === 'slip_file' && req.files && req.files['bank_slip_file'] ? req.files['bank_slip_file'][0].filename : txn_id;

    let newTempId = Date.now();
    pendingStudents.push({
        id: newTempId,
        student_id: autoID,
        password: autoPIN,
        name: name.trim(),
        father_name, mother_name, gender, age, phone, emergency_phone,
        region, zone, woreda, kebele,
        department: department.trim(),
        class_level: assignedSection,
        payment_type,
        bank_slip_val: slipPath,
        photo: photoPath
    });

    res.send(`
    <div style="font-family:sans-serif; text-align:center; padding:40px;">
        <h2 style="color:green;">✅ የምዝገባ ጥያቄዎ ለአድሚን ተልኳል!</h2>
        <div style="background:#eef2f5; display:inline-block; padding:20px; border-radius:8px; text-align:left; border:2px dashed #1f4e79;">
            <p><strong>የተመደቡበት ክፍል/ሴክሽን:</strong> <span style="color:#27ae60; font-size:20px; font-weight:bold;">${assignedSection}</span></p>
            <p><strong>የተመደበልዎ ID Number:</strong> <span style="color:#c0392b; font-size:18px; font-weight:bold;">${autoID}</span></p>
            <p><strong>Your 4-Digit Password PIN:</strong> <span style="color:#c0392b; font-size:18px; font-weight:bold;">${autoPIN}</span></p>
            <p style="color:#d35400;">⚠️ <b>እባክዎ ይህንን ID እና Password በግልዎ ይያዙ!</b> አድሚኑ ሲያጸድቀው በዚህ መረጃ ገብተው መታወቂያዎን ማውረድ ይችላሉ።</p>
            <p><a href="/download-pending-slip/${newTempId}" style="background:#e67e22; color:white; padding:8px 15px; text-decoration:none; border-radius:5px; display:inline-block; margin-top:10px;">📥 Download Registration Slip PDF</a></p>
        </div><br><br>
        <a href="/" style="background:#1f4e79; color:white; padding:10px 20px; text-decoration:none; border-radius:6px; font-weight:bold;">ወደ መግቢያ ገጽ ተመልስ</a>
    </div>
    `);
});

app.get('/download-pending-slip/:id', (req, res) => {
    const id = parseInt(req.params.id);
    let st = pendingStudents.find(s => s.id === id) || Object.values(studentData).find(s => s.id === id);
    if (!st) return res.send('Record not found');

    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=Registration-Slip-${st.student_id}.pdf`);
    doc.pipe(res);

    doc.fontSize(20).fillColor('#1f4e79').text('MADDA WALABU UNIVERSITY', { align: 'center' });
    doc.fontSize(14).fillColor('#333').text('Student Registration & Payment Verification Slip', { align: 'center' });
    doc.moveDown();

    doc.fontSize(12).text(`Student ID: ${st.student_id}`);
    doc.text(`Password PIN: ${st.password}`);
    doc.text(`Full Name: ${st.name} ${st.father_name}`);
    doc.text(`Department: ${st.department}`);
    doc.text(`Assigned Class/Section: ${st.class_level}`);
    doc.text(`Phone: ${st.phone}`);
    doc.text(`Payment Type: ${st.payment_type}`);
    doc.text(`Payment Ref / Slip Detail: ${st.bank_slip_val}`);
    doc.moveDown();
    doc.text('Status: Pending Admin Approval / Confirmed', { oblique: true });

    doc.end();
});

// LOGIN LOGIC
app.post('/login', (req, res) => {
    const { role, username, password } = req.body;
    const uKey = username.trim();

    if (role === 'admin' && uKey === ADMIN_USER && password === ADMIN_PASS) {
        req.session.isAdminLoggedIn = true;
        return res.redirect('/admin');
    } else if (role === 'teacher') {
        const teacherKey = uKey.toUpperCase();
        if (teacherAccounts[teacherKey] && teacherAccounts[teacherKey].pass === password) {
            req.session.teacherId = teacherKey;
            return res.redirect('/teacher-dashboard');
        }
    } else if (role === 'student') {
        const uppercaseKey = uKey.toUpperCase();
        if (studentAccounts[uppercaseKey] && studentAccounts[uppercaseKey] === password.trim()) {
            req.session.studentId = uppercaseKey;
            return res.redirect('/student-dashboard');
        }
    }
    res.send('<h3 style="color:red; text-align:center; margin-top:50px;">❌ የተሳሳተ መረጃ አስገብተዋል ወይም ምዝገባዎ ገና በአድሚን አልፀደቀም! <a href="/">ተመልሰው ይሞክሩ</a></h3>');
});

// TEACHER DASHBOARD (Assessment & Grade Management)
app.get('/teacher-dashboard', (req, res) => {
    if (!req.session.teacherId) return res.redirect('/');
    const teacher = teacherAccounts[req.session.teacherId];
    if (!teacher) return res.redirect('/');

    let assignedSecStudents = Object.values(studentData).filter(s => s.class_level === teacher.assigned_section);

    let studentRows = assignedSecStudents.map(st => {
        let assessment = studentAssessments[st.student_id] || { quiz: 0, mid: 0, final: 0, total: 0, remark: 'Not Graded' };
        return `
        <tr>
            <td>${st.student_id}</td>
            <td>${st.name} ${st.father_name}</td>
            <form action="/teacher/save-grade" method="POST">
                <input type="hidden" name="student_id" value="${st.student_id}">
                <td><input type="number" name="quiz" value="${assessment.quiz}" min="0" max="20" style="width:60px; padding:5px;"></td>
                <td><input type="number" name="mid" value="${assessment.mid}" min="0" max="30" style="width:60px; padding:5px;"></td>
                <td><input type="number" name="final" value="${assessment.final}" min="0" max="50" style="width:60px; padding:5px;"></td>
                <td><strong>${assessment.total}</strong></td>
                <td><span style="color: ${assessment.remark === 'Pass' ? 'green' : (assessment.remark === 'Fail' ? 'red' : 'orange')}">${assessment.remark}</span></td>
                <td><button type="submit" style="background:#27ae60; color:white; border:none; padding:5px 10px; border-radius:4px; cursor:pointer;">💾 Save</button></td>
            </form>
        </tr>`;
    }).join('') || '<tr><td colspan="7">በዚህ ሴክሽን የተመዘገበ ተማሪ የለም</td></tr>';

    res.send(`
    <!DOCTYPE html>
    <html lang="am">
    <head>
        <meta charset="UTF-8"><title>Teacher Dashboard - Assessments</title>
        <style>
            body { font-family: sans-serif; background: #eef2f5; padding: 20px; font-size: 15px; }
            .container { max-width: 900px; margin: 0 auto; background: white; padding: 25px; border-radius: 10px; box-shadow: 0 4px 10px rgba(0,0,0,0.1); }
            table { width: 100%; border-collapse: collapse; margin-top: 15px; }
            th, td { border: 1px solid #ddd; padding: 10px; text-align: center; }
            th { background: #1f4e79; color: white; }
        </style>
    </head>
    <body>
        <div class="container">
            <h2>👨‍🏫 መምህር ዳሽቦርድ (Teacher Assessment Portal)</h2>
            <div style="background:#f4f7f6; padding:12px; border-radius:6px; margin-bottom:15px;">
                <p><strong>ስም:</strong> ${teacher.name} | <strong>ክፍል/ዲፓርትመንት:</strong> ${teacher.dept}</p>
                <p><strong>የተመደቡበት ሴክሽን:</strong> <span style="color:#27ae60; font-weight:bold;">${teacher.assigned_section}</span></p>
            </div>
            <h3>📝 የተማሪዎች ግምገማ እና ውጤት መስጫ (Quiz / Mid / Final)</h3>
            <table>
                <thead>
                    <tr>
                        <th>ID Number</th>
                        <th>Student Name</th>
                        <th>Quiz (20%)</th>
                        <th>Mid Exam (30%)</th>
                        <th>Final Exam (50%)</th>
                        <th>Total (100%)</th>
                        <th>Status</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>
                    ${studentRows}
                </tbody>
            </table>
            <br>
            <a href="/logout" style="color:red; font-weight:bold; font-size:16px;">🔒 Logout</a>
        </div>
    </body>
    </html>
    `);
});

// SAVE GRADE/ASSESSMENT POST ENDPOINT
app.post('/teacher/save-grade', (req, res) => {
    if (!req.session.teacherId) return res.redirect('/');
    const { student_id, quiz, mid, final } = req.body;

    let q = parseFloat(quiz) || 0;
    let m = parseFloat(mid) || 0;
    let f = parseFloat(final) || 0;
    let total = q + m + f;
    let remark = total >= 50 ? 'Pass' : 'Fail';

    studentAssessments[student_id] = {
        quiz: q,
        mid: m,
        final: f,
        total: total,
        remark: remark
    };

    res.redirect('/teacher-dashboard');
});

// ADMIN DASHBOARD
app.get('/admin', (req, res) => {
    if (!req.session.isAdminLoggedIn) return res.redirect('/');

    let allStudents = Object.values(studentData);
    let sectionMap = {};

    allStudents.forEach(st => {
        if (!sectionMap[st.class_level]) sectionMap[st.class_level] = [];
        sectionMap[st.class_level].push(st);
    });

    let pendingRows = pendingStudents.map(st => {
        return `<tr>
            <td><img src="/uploads/${st.photo}" style="width:40px; height:45px; object-fit:cover;"></td>
            <td>${st.student_id}</td>
            <td>${st.name} (${st.gender})</td>
            <td>${st.phone}</td>
            <td><strong style="color:#e67e22;">${st.class_level}</strong></td>
            <td><a href="/download-pending-slip/${st.id}" target="_blank">📄 PDF Slip</a></td>
            <td><a href="/admin/approve-student/${st.id}" style="background:green; color:white; padding:6px 12px; border-radius:4px; text-decoration:none; font-weight:bold;">✅ Approve</a></td>
        </tr>`;
    }).join('') || '<tr><td colspan="7">ምንም ያልፀደቀ አዲስ ጥያቄ የለም</td></tr>';

    let sectionBlocksHtml = Object.keys(sectionMap).map(secName => {
        let list = sectionMap[secName];
        let monitor = sectionMonitors[secName] || { name: "አልተመደበም", phone: "-" };
        let assignedTeacher = Object.values(teacherAccounts).find(t => t.assigned_section === secName);
        let teacherName = assignedTeacher ? assignedTeacher.name : "አልተመደበም";

        let studentRows = list.map(st => {
            let assessment = studentAssessments[st.student_id] || { total: '-', remark: '-' };
            return `
            <tr>
                <td><img src="/uploads/${st.photo}" style="width:35px; height:40px; object-fit:cover; border-radius:3px;"></td>
                <td><strong>${st.student_id}</strong></td>
                <td>${st.name} ${st.father_name}</td>
                <td>${st.gender} / ${st.age}</td>
                <td>${st.phone}</td>
                <td><strong>${assessment.total} / 100 (${assessment.remark})</strong></td>
                <td>
                    <a href="/admin/edit-student/${st.student_id}" style="background:#3498db; color:white; padding:4px 8px; border-radius:4px; text-decoration:none; font-size:12px;">✏️ Edit</a>
                    <a href="/download-id-pdf/${st.student_id}" style="background:#8e44ad; color:white; padding:4px 8px; border-radius:4px; text-decoration:none; font-size:12px;">📥 PDF ID</a>
                </td>
            </tr>`;
        }).join('') || '<tr><td colspan="7">በዚህ ሴክሽን የተመዘገበ ተማሪ የለም</td></tr>';

        return `
        <div style="background:#ffffff; border:2px solid #1f4e79; border-radius:10px; padding:15px; margin-bottom:25px;">
            <div style="display:flex; justify-content:space-between; align-items:center; background:#1f4e79; color:white; padding:10px 15px; border-radius:6px;">
                <h3 style="margin:0;">📌 ${secName}</h3>
            </div>
            <div style="margin:12px 0; font-size:14px; background:#f4f7f6; padding:10px; border-radius:6px;">
                <span><strong>👨‍🏫 Teacher:</strong> ${teacherName}</span> | 
                <span style="margin-left:15px;"><strong>👥 Enrolled:</strong> ${list.length} / 50</span>
            </div>
            <table style="width:100%; border-collapse:collapse; margin-top:10px; font-size:13px;">
                <thead>
                    <tr style="background:#34495e; color:white;">
                        <th>Photo</th><th>ID</th><th>Full Name</th><th>Gender/Age</th><th>Phone</th><th>Total Grade</th><th>Actions</th>
                    </tr>
                </thead>
                <tbody>${studentRows}</tbody>
            </table>
        </div>`;
    }).join('');

    let teacherRows = Object.values(teacherAccounts).map(t => `
        <tr>
            <td>${t.id}</td><td>${t.name}</td><td>${t.dept}</td><td>${t.phone}</td><td><strong>${t.assigned_section || "None"}</strong></td>
        </tr>
    `).join('');

    res.send(`
    <!DOCTYPE html>
    <html lang="am">
    <head><meta charset="UTF-8"><title>Admin Dashboard</title>
    <style>body { font-family: sans-serif; background: #eef2f5; padding: 20px; font-size: 14px; } .card { background: white; padding: 20px; border-radius: 10px; margin-bottom: 25px; } table { width: 100%; border-collapse: collapse; margin-top:10px; } th, td { border: 1px solid #ddd; padding: 8px; text-align: center; } th { background: #34495e; color: white; }</style>
    </head>
    <body>
        <h2>🔐 ADMIN CENTRAL CONTROL DASHBOARD</h2>
        <div class="card">
            <h3>📥 አዲስ የተመዘገቡ ተማሪዎች (Pending Approvals)</h3>
            <table><thead><tr><th>Photo</th><th>ID</th><th>Name</th><th>Phone</th><th>Class</th><th>Slip PDF</th><th>Action</th></tr></thead><tbody>${pendingRows}</tbody></table>
        </div>
        <div class="card">
            <h3>📂 የሴክሽኖች ሙሉ መረጃ እና የተማሪዎች ውጤት</h3>
            ${sectionBlocksHtml || '<p>ምንም የተመደቡ ሴክሽኖች የሉም</p>'}
        </div>
        <div class="card">
            <h3>👨‍🏫 የመምህራን ዝርዝር</h3>
            <table><thead><tr><th>ID</th><th>Name</th><th>Dept</th><th>Phone</th><th>Section</th></tr></thead><tbody>${teacherRows}</tbody></table>
        </div>
        <a href="/logout" style="color:red; font-weight:bold; font-size:18px;">🔒 Logout</a>
    </body>
    </html>
    `);
});

// ADMIN APPROVE REGISTRATION
app.get('/admin/approve-student/:id', (req, res) => {
    if (!req.session.isAdminLoggedIn) return res.redirect('/');
    const id = parseInt(req.params.id);
    const index = pendingStudents.findIndex(s => s.id === id);

    if (index !== -1) {
        const st = pendingStudents[index];
        studentData[st.student_id] = {
            ...st,
            status: "Approved",
            admin_message: `🎉 እንኳን ደስ አለዎት! ምዝገባዎ ጸድቋል። ከታች ያለውን ቁልፍ በመጫን የዲጂታል መታወቂያዎ ማውረድ ይችላሉ!`
        };
        studentAccounts[st.student_id] = st.password;
        pendingStudents.splice(index, 1);
    }
    res.redirect('/admin');
});

// EDIT STUDENT FORM
app.get('/admin/edit-student/:id', (req, res) => {
    if (!req.session.isAdminLoggedIn) return res.redirect('/');
    const st = studentData[req.params.id];
    if (!st) return res.send('Student not found');

    res.send(`
    <div style="font-family:sans-serif; max-width:500px; margin:30px auto; padding:20px; background:white; border-radius:10px;">
        <h3>✏️ የተማሪ መረጃ ማስተካከያ (${st.student_id})</h3>
        <form action="/admin/update-student" method="POST">
            <input type="hidden" name="student_id" value="${st.student_id}">
            <label>ሙሉ ስም:</label><br><input type="text" name="name" value="${st.name}" style="width:100%; padding:8px; margin-bottom:10px;"><br>
            <label>የትምህርት ክፍል (Dept):</label><br><input type="text" name="department" value="${st.department}" style="width:100%; padding:8px; margin-bottom:10px;"><br>
            <label>ክፍል/ሴክሽን (Section):</label><br><input type="text" name="class_level" value="${st.class_level}" style="width:100%; padding:8px; margin-bottom:10px;"><br>
            <button type="submit" style="background:#27ae60; color:white; padding:10px; border:none; border-radius:5px; width:100%; font-weight:bold;">💾 መረጃውን አዘምን</button>
        </form>
        <br><a href="/admin" style="text-decoration:none; color:#1f4e79;">⬅️ ተመለስ</a>
    </div>
    `);
});

app.post('/admin/update-student', (req, res) => {
    if (!req.session.isAdminLoggedIn) return res.redirect('/');
    const { student_id, name, department, class_level } = req.body;
    if (studentData[student_id]) {
        studentData[student_id].name = name;
        studentData[student_id].department = department;
        studentData[student_id].class_level = class_level;
    }
    res.redirect('/admin');
});

// GENERATE DIGITAL ID PDF
app.get('/download-id-pdf/:id', (req, res) => {
    const student = studentData[req.params.id];
    if (!student) return res.send('Student not found');

    const doc = new PDFDocument({ size: [400, 260], margin: 15 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=MWU-Digital-ID-${student.student_id}.pdf`);
    doc.pipe(res);

    doc.rect(10, 10, 380, 240).lineWidth(2).strokeColor('#1f4e79').fillAndStroke('#fdfefe', '#1f4e79');
    doc.fontSize(12).fillColor('#1f4e79').text('MADDA WALABU UNIVERSITY', 20, 20, { align: 'center', bold: true });
    doc.fontSize(9).fillColor('#e74c3c').text('OFFICIAL DIGITAL STUDENT ID CARD', 20, 35, { align: 'center' });
    doc.moveTo(20, 50).lineTo(380, 50).strokeColor('#ccc').stroke();

    let photoFile = path.join(__dirname, 'uploads', student.photo);
    if (fs.existsSync(photoFile)) {
        doc.image(photoFile, 20, 60, { width: 80, height: 95 });
    }

    doc.fontSize(10).fillColor('#000');
    doc.text(`Full Name: ${student.name} ${student.father_name}`, 115, 60);
    doc.text(`ID Number: ${student.student_id}`, 115, 78, { bold: true });
    doc.text(`Department: ${student.department}`, 115, 96);
    doc.text(`Class/Section: ${student.class_level}`, 115, 114);
    doc.text(`Phone: ${student.phone}`, 115, 132);

    doc.end();
});

// STUDENT DASHBOARD WITH ASSESSMENTS/GRADES
app.get('/student-dashboard', (req, res) => {
    if (!req.session.studentId) return res.redirect('/');
    const student = studentData[req.session.studentId];
    if (!student) return res.redirect('/');
    let monitor = sectionMonitors[student.class_level] || { name: "አልተመደበም", phone: "-" };
    let assessment = studentAssessments[student.student_id] || { quiz: 0, mid: 0, final: 0, total: 0, remark: 'Not Graded Yet' };

    res.send(`
    <!DOCTYPE html>
    <html lang="am">
    <head><meta charset="UTF-8"><title>Student Dashboard</title>
    <style>
        body { font-family: sans-serif; background: #f4f7f6; padding: 20px; } 
        .container { max-width: 600px; margin: 0 auto; background: white; padding: 25px; border-radius: 12px; box-shadow: 0 4px 10px rgba(0,0,0,0.1); }
        .grade-box { background: #eef2f5; padding: 15px; border-radius: 8px; margin-top: 15px; border-left: 5px solid #1f4e79; }
    </style>
    </head>
    <body>
        <div class="container">
            <h2>🎓 የተማሪ ዳሽቦርድ (Student Dashboard)</h2>
            <div style="background:#d4edda; color:#155724; padding:15px; border-radius:8px; margin-bottom:15px;">
                📢 ${student.admin_message}
            </div>
            <h3>${student.name} (${student.student_id})</h3>
            <p><strong>Assigned Class:</strong> ${student.class_level}</p>
            <p><strong>Department:</strong> ${student.department}</p>
            <p><strong>Class Monitor:</strong> ${monitor.name} (${monitor.phone})</p>
            
            <div class="grade-box">
                <h4>📊 የውጤት እና ግምገማ ሁኔታ (Assessment & Grades)</h4>
                <p><strong>Quiz (20%):</strong> ${assessment.quiz}</p>
                <p><strong>Mid Exam (30%):</strong> ${assessment.mid}</p>
                <p><strong>Final Exam (50%):</strong> ${assessment.final}</p>
                <p><strong>Total Score:</strong> <span style="color:#1f4e79; font-weight:bold; font-size:18px;">${assessment.total} / 100</span></p>
                <p><strong>Status:</strong> <span style="color:${assessment.remark === 'Pass' ? 'green' : 'red'}; font-weight:bold;">${assessment.remark}</span></p>
            </div>
            
            <br>
            <a href="/download-id-pdf/${student.student_id}" style="background:#27ae60; color:white; padding:10px 18px; text-decoration:none; border-radius:6px; font-weight:bold; display:inline-block;">📥 Download Digital ID (PDF)</a>
            <br><br>
            <a href="/logout" style="color:red; font-weight:bold;">🔒 Logout</a>
        </div>
    </body>
    </html>
    `);
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
