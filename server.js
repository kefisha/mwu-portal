Cat << 'EOF' > server.js
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 3000;

if (!fs.existsSync('./uploads')) {
    fs.mkdirSync('./uploads');
}

// Database Setup
const dbFile = './mwu_portal.db';
const db = new sqlite3.Database(dbFile, (err) => {
    if (err) console.error('Database opening error: ', err.message);
    else console.log('Connected to SQLite Database.');
});

// Create Tables
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS students (
        student_id TEXT PRIMARY KEY,
        password TEXT,
        name TEXT,
        father_name TEXT,
        mother_name TEXT,
        gender TEXT,
        age INTEGER,
        phone TEXT,
        emergency_phone TEXT,
        region TEXT,
        zone TEXT,
        woreda TEXT,
        kebele TEXT,
        department TEXT,
        class_level TEXT,
        payment_type TEXT,
        bank_slip_val TEXT,
        photo TEXT,
        status TEXT,
        admin_message TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS pending_students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id TEXT,
        password TEXT,
        name TEXT,
        father_name TEXT,
        mother_name TEXT,
        gender TEXT,
        age INTEGER,
        phone TEXT,
        emergency_phone TEXT,
        region TEXT,
        zone TEXT,
        woreda TEXT,
        kebele TEXT,
        department TEXT,
        class_level TEXT,
        payment_type TEXT,
        bank_slip_val TEXT,
        photo TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS assessments (
        student_id TEXT PRIMARY KEY,
        quiz REAL,
        mid REAL,
        final REAL,
        total REAL,
        remark TEXT
    )`);
});

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

let teacherAccounts = {
    "T-101": { id: "T-101", name: "Dr. Teshale Kebede", dept: "Statistics", pass: "123456", phone: "0911001122", assigned_section: "1st Year - Section A" },
    "T-102": { id: "T-102", name: "Abebech Bekele", dept: "Computer Science", pass: "123456", phone: "0922334455", assigned_section: "1st Year - Section B" }
};

let sectionMonitors = {
    "1st Year - Section A": { name: "Kefyalew Kebede (Monitor)", phone: "0912345678" },
    "1st Year - Section B": { name: "Chala Tesfaye (Monitor)", phone: "0987654321" }
};

function generateStudentID() {
    return `MWU-${Math.floor(1000 + Math.random() * 9000)}`;
}

function generate4DigitPIN() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

function assignClassSection(requestedYearLevel, callback) {
    const letters = ["A", "B", "C", "D", "E", "F", "G"];
    let checkNext = (index) => {
        if (index >= letters.length) return callback(`${requestedYearLevel} - Section Overflow`);
        let secName = `${requestedYearLevel} - Section ${letters[index]}`;
        
        db.get(`SELECT COUNT(*) as count FROM students WHERE class_level = ?`, [secName], (err, row1) => {
            db.get(`SELECT COUNT(*) as count FROM pending_students WHERE class_level = ?`, [secName], (err, row2) => {
                let total = (row1 ? row1.count : 0) + (row2 ? row2.count : 0);
                if (total < 50) {
                    callback(secName);
                } else {
                    checkNext(index + 1);
                }
            });
        });
    };
    checkNext(0);
}

// LANDING PAGE (WITH LANGUAGE TOGGLE)
app.get('/', (req, res) => {
    const lang = req.query.lang === 'en' ? 'en' : 'am';
    
    const text = {
        am: {
            title: "🎓 የመዳ ወላቡ ዩኒቨርሲቲ ዲጂታል ፖርታል",
            student: "🎓 ተማሪ (Student Login)",
            teacher: "👨‍🏫 መምህር (Teacher Login)",
            admin: "🔐 አድሚን (Admin Login)",
            placeholderId: "የመታወቂያ ቁጥር / መለያ (ID or Username)",
            placeholderPass: "የሚስጥር ቁጥር ፒን (Password PIN)",
            loginBtn: "ግባ (Log In)",
            registerBtn: "📝 አዲስ ተማሪ ምዝገባ (Self Register)"
        },
        en: {
            title: "🎓 MWU DIGITAL PORTAL",
            student: "🎓 Student Login",
            teacher: "👨‍🏫 Teacher Login",
            admin: "🔐 Admin Login",
            placeholderId: "ID Number / Username",
            placeholderPass: "Password PIN",
            loginBtn: "Log In",
            registerBtn: "📝 New Student Self Registration"
        }
    }[lang];

    res.send(`
    <!DOCTYPE html>
    <html lang="${lang}">
    <head>
        <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>MWU Digital Portal</title>
        <style>
            * { box-sizing: border-box; font-family: sans-serif; }
            body { background-color: #f4f7f6; margin: 0; padding: 20px; font-size: 18px; }
            .container { max-width: 480px; margin: 30px auto; text-align: center; background: white; padding: 30px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); position: relative; }
            .lang-switch { position: absolute; top: 15px; right: 20px; font-size: 14px; font-weight: bold; }
            .lang-switch a { text-decoration: none; color: #1f4e79; margin-left: 5px; padding: 3px 8px; border: 1px solid #1f4e79; border-radius: 4px; }
            .lang-switch a.active { background: #1f4e79; color: white; }
            h2 { font-size: 22px; color: #1f4e79; margin-bottom:20px; margin-top:30px; }
            select, input { width: 100%; padding: 14px; margin-bottom: 15px; border: 1px solid #ccc; border-radius: 8px; font-size: 16px; }
            .btn-login { width: 100%; padding: 14px; background: #1f4e79; color: white; border: none; border-radius: 8px; font-size: 18px; font-weight: bold; cursor: pointer; }
            .btn-register { display: block; margin-top: 15px; background: #27ae60; color: white; text-decoration: none; padding: 12px; border-radius: 8px; font-weight: bold; font-size: 16px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="lang-switch">
                <a href="/?lang=am" class="${lang === 'am' ? 'active' : ''}">አማርኛ</a>
                <a href="/?lang=en" class="${lang === 'en' ? 'active' : ''}">English</a>
            </div>
            <h2>${text.title}</h2>
            <form action="/login?lang=${lang}" method="POST">
                <select name="role">
                    <option value="student">${text.student}</option>
                    <option value="teacher">${text.teacher}</option>
                    <option value="admin">${text.admin}</option>
                </select>
                <input type="text" name="username" placeholder="${text.placeholderId}" required>
                <input type="password" name="password" placeholder="${text.placeholderPass}" required>
                <button type="submit" class="btn-login">${text.loginBtn}</button>
            </form>
            <hr style="margin-top:20px;">
            <a href="/student-register?lang=${lang}" class="btn-register">${text.registerBtn}</a>
        </div>
    </body>
    </html>
    `);
});

// STUDENT REGISTRATION FORM (WITH LANGUAGE OPTION)
app.get('/student-register', (req, res) => {
    const lang = req.query.lang === 'en' ? 'en' : 'am';

    const t = {
        am: {
            title: "📝 ሙሉ የተማሪዎች ምዝገባ ፎርም",
            name: "ሙሉ ስም (Full Name):",
            father: "የአባት ስም:",
            mother: "የእናት ስም:",
            gender: "ጾታ:",
            male: "ወንድ (Male)",
            female: "ሴት (Female)",
            age: "ዕድሜ:",
            phone: "ስልክ ቁጥር:",
            emerg: "የአደጋ ጊዜ ተጠሪ ስልክ:",
            region: "ክልል:",
            zone: "ዞን:",
            woreda: "ወረዳ:",
            kebele: "ቀበሌ:",
            dept: "ትምህርት ክፍል (Department):",
            year: "የትምህርት ዓመት ደረጃ (Year Level):",
            photo: "የተማሪው ጉርድ ፎቶ (Passport Photo):",
            payType: "የክፍያ ማረጋገጫ አይነት:",
            txnOpt: "የትራንዛክሽን ቁጥር (Txn Ref)",
            slipOpt: "የደረሰኝ ፎቶ/PDF ማያያዝ",
            txnLabel: "Transaction ID / Ref Number:",
            slipLabel: "Bank Slip Document (Image/PDF):",
            submitBtn: "🚀 ምዝገባውን ለአድሚን ላክ",
            back: "⬅️ ተመለስ"
        },
        en: {
            title: "📝 Student Registration Form",
            name: "Full Name:",
            father: "Father's Name:",
            mother: "Mother's Name:",
            gender: "Gender:",
            male: "Male",
            female: "Female",
            age: "Age:",
            phone: "Phone Number:",
            emerg: "Emergency Phone:",
            region: "Region:",
            zone: "Zone:",
            woreda: "Woreda:",
            kebele: "Kebele:",
            dept: "Department:",
            year: "Academic Year Level:",
            photo: "Passport Photo:",
            payType: "Payment Verification Type:",
            txnOpt: "Transaction Ref Number",
            slipOpt: "Upload Bank Slip (Image/PDF)",
            txnLabel: "Transaction ID / Ref Number:",
            slipLabel: "Bank Slip Document (Image/PDF):",
            submitBtn: "🚀 Submit Registration to Admin",
            back: "⬅️ Back"
        }
    }[lang];

    res.send(`
    <!DOCTYPE html>
    <html lang="${lang}">
    <head>
        <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Student Registration</title>
        <style>
            body { font-family: sans-serif; background: #eef2f5; padding: 15px; font-size: 16px; }
            .container { max-width: 600px; margin: 0 auto; background: white; padding: 25px; border-radius: 12px; position:relative; }
            .lang-switch { position: absolute; top: 15px; right: 20px; font-size: 14px; font-weight: bold; }
            .lang-switch a { text-decoration: none; color: #1f4e79; margin-left: 5px; padding: 3px 8px; border: 1px solid #1f4e79; border-radius: 4px; }
            .lang-switch a.active { background: #1f4e79; color: white; }
            h2 { font-size: 22px; text-align: center; color: #1f4e79; margin-top:25px; }
            input, select { width: 100%; padding: 10px; margin-top: 4px; margin-bottom: 12px; border: 1px solid #ccc; border-radius: 6px; box-sizing: border-box; }
            label { font-weight: bold; font-size: 14px; }
            .row { display: flex; gap: 10px; }
            .col { flex: 1; }
            .btn-submit { background: #27ae60; color: white; border: none; padding: 14px; width: 100%; margin-top: 15px; border-radius: 8px; font-weight: bold; font-size: 17px; cursor: pointer; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="lang-switch">
                <a href="/student-register?lang=am" class="${lang === 'am' ? 'active' : ''}">አማርኛ</a>
                <a href="/student-register?lang=en" class="${lang === 'en' ? 'active' : ''}">English</a>
            </div>
            <h2>${t.title}</h2>
            <form action="/api/student-self-register?lang=${lang}" method="POST" enctype="multipart/form-data">
                <label>${t.name}</label><input type="text" name="name" required>
                <div class="row">
                    <div class="col"><label>${t.father}</label><input type="text" name="father_name" required></div>
                    <div class="col"><label>${t.mother}</label><input type="text" name="mother_name" required></div>
                </div>
                <div class="row">
                    <div class="col"><label>${t.gender}</label><select name="gender"><option value="Male">${t.male}</option><option value="Female">${t.female}</option></select></div>
                    <div class="col"><label>${t.age}</label><input type="number" name="age" required></div>
                </div>
                <div class="row">
                    <div class="col"><label>${t.phone}</label><input type="text" name="phone" required></div>
                    <div class="col"><label>${t.emerg}</label><input type="text" name="emergency_phone" required></div>
                </div>
                <div class="row">
                    <div class="col"><label>${t.region}</label><input type="text" name="region" required></div>
                    <div class="col"><label>${t.zone}</label><input type="text" name="zone" required></div>
                </div>
                <div class="row">
                    <div class="col"><label>${t.woreda}</label><input type="text" name="woreda" required></div>
                    <div class="col"><label>${t.kebele}</label><input type="text" name="kebele" required></div>
                </div>
                <label>${t.dept}</label><input type="text" name="department" required>
                <label>${t.year}</label>
                <select name="year_level">
                    <option value="1st Year">1st Year</option><option value="2nd Year">2nd Year</option>
                    <option value="3rd Year">3rd Year</option><option value="4th Year">4th Year</option>
                </select>
                <label>${t.photo}</label><input type="file" name="student_photo" accept="image/*" required>
                <label>${t.payType}</label>
                <select name="payment_type" id="payType" onchange="togglePay()">
                    <option value="txn_id">${t.txnOpt}</option>
                    <option value="slip_file">${t.slipOpt}</option>
                </select>
                <div id="txnBox"><label>${t.txnLabel}</label><input type="text" name="txn_id" placeholder="e.g. FT240981123"></div>
                <div id="slipBox" style="display:none;"><label>${t.slipLabel}</label><input type="file" name="bank_slip_file" accept="image/*,.pdf"></div>
                <button type="submit" class="btn-submit">${t.submitBtn}</button>
            </form>
            <br><a href="/?lang=${lang}" style="text-decoration:none; color:#1f4e79; font-weight:bold;">${t.back}</a>
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

const registerUpload = upload.fields([{ name: 'student_photo', maxCount: 1 }, { name: 'bank_slip_file', maxCount: 1 }]);

app.post('/api/student-self-register', registerUpload, (req, res) => {
    const lang = req.query.lang === 'en' ? 'en' : 'am';
    const { name, father_name, mother_name, gender, age, phone, emergency_phone, region, zone, woreda, kebele, department, year_level, payment_type, txn_id } = req.body;

    let autoID = generateStudentID();
    let autoPIN = generate4DigitPIN();

    assignClassSection(year_level, (assignedSection) => {
        let photoPath = req.files && req.files['student_photo'] ? req.files['student_photo'][0].filename : '';
        let slipPath = payment_type === 'slip_file' && req.files && req.files['bank_slip_file'] ? req.files['bank_slip_file'][0].filename : txn_id;

        db.run(`INSERT INTO pending_students (student_id, password, name, father_name, mother_name, gender, age, phone, emergency_phone, region, zone, woreda, kebele, department, class_level, payment_type, bank_slip_val, photo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [autoID, autoPIN, name.trim(), father_name, mother_name, gender, age, phone, emergency_phone, region, zone, woreda, kebele, department.trim(), assignedSection, payment_type, slipPath, photoPath], function(err) {
            if (err) return res.status(500).send('Database Error');
            let newTempId = this.lastID;

            const msg = lang === 'en' ? {
                success: "✅ Registration request successfully sent to Admin!",
                class: "Assigned Class/Section:",
                id: "Assigned ID Number:",
                pin: "Your 4-Digit Password PIN:",
                warning: "⚠️ Please keep this ID and Password safe! You can download your ID card once approved.",
                slip: "📥 Download Registration Slip PDF",
                home: "Back to Home"
            } : {
                success: "✅ የምዝገባ ጥያቄዎ ለአድሚን ተልኳል!",
                class: "የተመደቡበት ክፍል/ሴክሽን:",
                id: "የተመደበልዎ ID Number:",
                pin: "Your 4-Digit Password PIN:",
                warning: "⚠️ እባክዎ ይህንን ID እና Password በግልዎ ይያዙ! አድሚኑ ሲያጸድቀው ማውረድ ይችላሉ።",
                slip: "📥 Download Registration Slip PDF",
                home: "ወደ መግቢያ ገጽ ተመልስ"
            };

            res.send(`
            <div style="font-family:sans-serif; text-align:center; padding:40px;">
                <h2 style="color:green;">${msg.success}</h2>
                <div style="background:#eef2f5; display:inline-block; padding:20px; border-radius:8px; text-align:left; border:2px dashed #1f4e79;">
                    <p><strong>${msg.class}</strong> <span style="color:#27ae60; font-size:20px;">${assignedSection}</span></p>
                    <p><strong>${msg.id}</strong> <span style="color:#c0392b; font-size:18px;">${autoID}</span></p>
                    <p><strong>${msg.pin}</strong> <span style="color:#c0392b; font-size:18px;">${autoPIN}</span></p>
                    <p style="color:#d35400;"><b>${msg.warning}</b></p>
                    <p><a href="/download-pending-slip/${newTempId}" style="background:#e67e22; color:white; padding:8px 15px; text-decoration:none; border-radius:5px; display:inline-block;">${msg.slip}</a></p>
                </div><br><br>
                <a href="/?lang=${lang}" style="background:#1f4e79; color:white; padding:10px 20px; text-decoration:none; border-radius:6px;">${msg.home}</a>
            </div>
            `);
        });
    });
});

app.get('/download-pending-slip/:id', (req, res) => {
    const id = req.params.id;
    db.get(`SELECT * FROM pending_students WHERE id = ? UNION SELECT * FROM students WHERE student_id = ?`, [id, id], (err, st) => {
        if (!st) return res.send('Record not found');

        const doc = new PDFDocument();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Registration-Slip-${st.student_id}.pdf`);
        doc.pipe(res);
        doc.fontSize(20).fillColor('#1f4e79').text('MADDA WALABU UNIVERSITY', { align: 'center' });
        doc.fontSize(14).fillColor('#333').text('Registration Slip', { align: 'center' });
        doc.moveDown();
        doc.fontSize(12).text(`Student ID: ${st.student_id}`);
        doc.text(`Password PIN: ${st.password}`);
        doc.text(`Full Name: ${st.name} ${st.father_name}`);
        doc.text(`Department: ${st.department}`);
        doc.text(`Assigned Class/Section: ${st.class_level}`);
        doc.text(`Phone: ${st.phone}`);
        doc.end();
    });
});

// LOGIN
app.post('/login', (req, res) => {
    const lang = req.query.lang === 'en' ? 'en' : 'am';
    const { role, username, password } = req.body;
    const uKey = username.trim();

    if (role === 'admin' && uKey === ADMIN_USER && password === ADMIN_PASS) {
        req.session.isAdminLoggedIn = true;
        return res.redirect('/admin');
    } else if (role === 'teacher') {
        const tKey = uKey.toUpperCase();
        if (teacherAccounts[tKey] && teacherAccounts[tKey].pass === password) {
            req.session.teacherId = tKey;
            return res.redirect('/teacher-dashboard');
        }
    } else if (role === 'student') {
        const sKey = uKey.toUpperCase();
        db.get(`SELECT * FROM students WHERE student_id = ? AND password = ?`, [sKey, password.trim()], (err, student) => {
            if (student) {
                req.session.studentId = sKey;
                return res.redirect('/student-dashboard');
            } else {
                const errText = lang === 'en' ? '❌ Incorrect credentials or account not yet approved by admin!' : '❌ የተሳሳተ መረጃ ወይም ምዝገባዎ ገና አልፀደቀም!';
                return res.send(`<h3 style="color:red; text-align:center; margin-top:50px;">${errText} <a href="/?lang=${lang}">Try again</a></h3>`);
            }
        });
        return;
    }
    res.send(`<h3 style="color:red; text-align:center; margin-top:50px;">❌ Invalid Login! <a href="/?lang=${lang}">Back</a></h3>`);
});

// TEACHER DASHBOARD
app.get('/teacher-dashboard', (req, res) => {
    if (!req.session.teacherId) return res.redirect('/');
    const teacher = teacherAccounts[req.session.teacherId];

    db.all(`SELECT s.*, a.quiz, a.mid, a.final, a.total, a.remark FROM students s LEFT JOIN assessments a ON s.student_id = a.student_id WHERE s.class_level = ?`, [teacher.assigned_section], (err, rows) => {
        let studentRows = rows.map(st => `
            <tr>
                <td>${st.student_id}</td>
                <td>${st.name} ${st.father_name}</td>
                <form action="/teacher/save-grade" method="POST">
                    <input type="hidden" name="student_id" value="${st.student_id}">
                    <td><input type="number" name="quiz" value="${st.quiz || 0}" min="0" max="20" style="width:60px;"></td>
                    <td><input type="number" name="mid" value="${st.mid || 0}" min="0" max="30" style="width:60px;"></td>
                    <td><input type="number" name="final" value="${st.final || 0}" min="0" max="50" style="width:60px;"></td>
                    <td><strong>${st.total || 0}</strong></td>
                    <td>${st.remark || 'Not Graded'}</td>
                    <td><button type="submit" style="background:#27ae60; color:white; border:none; padding:5px 10px; border-radius:4px;">💾 Save</button></td>
                </form>
            </tr>
        `).join('') || '<tr><td colspan="7">No students found</td></tr>';

        res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head><meta charset="UTF-8"><title>Teacher Dashboard</title>
        <style>body { font-family: sans-serif; background: #eef2f5; padding: 20px; } table { width: 100%; border-collapse: collapse; background:white; } th, td { border: 1px solid #ddd; padding: 10px; text-align: center; } th { background: #1f4e79; color: white; }</style>
        </head>
        <body>
            <div style="max-width:900px; margin:auto; background:white; padding:20px; border-radius:10px;">
                <h2>👨‍🏫 Teacher Dashboard (${teacher.name}) - ${teacher.assigned_section}</h2>
                <table>
                    <thead><tr><th>ID</th><th>Name</th><th>Quiz</th><th>Mid</th><th>Final</th><th>Total</th><th>Status</th><th>Action</th></tr></thead>
                    <tbody>${studentRows}</tbody>
                </table>
                <br><a href="/logout" style="color:red; font-weight:bold;">🔒 Logout</a>
            </div>
        </body>
        </html>
        `);
    });
});

app.post('/teacher/save-grade', (req, res) => {
    if (!req.session.teacherId) return res.redirect('/');
    const { student_id, quiz, mid, final } = req.body;
    let q = parseFloat(quiz) || 0, m = parseFloat(mid) || 0, f = parseFloat(final) || 0;
    let total = q + m + f;
    let remark = total >= 50 ? 'Pass' : 'Fail';

    db.run(`INSERT INTO assessments (student_id, quiz, mid, final, total, remark) VALUES (?, ?, ?, ?, ?, ?) 
            ON CONFLICT(student_id) DO UPDATE SET quiz=?, mid=?, final=?, total=?, remark=?`,
    [student_id, q, m, f, total, remark, q, m, f, total, remark], () => {
        res.redirect('/teacher-dashboard');
    });
});

// ADMIN DASHBOARD
app.get('/admin', (req, res) => {
    if (!req.session.isAdminLoggedIn) return res.redirect('/');
    const searchQuery = req.query.search ? `%${req.query.search}%` : '%';

    db.all(`SELECT * FROM pending_students`, [], (err, pendingRowsData) => {
        db.all(`SELECT s.*, a.total, a.remark FROM students s LEFT JOIN assessments a ON s.student_id = a.student_id WHERE s.name LIKE ? OR s.student_id LIKE ?`, [searchQuery, searchQuery], (err, allStudents) => {
            
            let pendingRows = pendingRowsData.map(st => `
                <tr>
                    <td>${st.student_id}</td><td>${st.name}</td><td>${st.phone}</td><td>${st.class_level}</td>
                    <td><a href="/admin/approve-student/${st.id}" style="background:green; color:white; padding:5px 10px; border-radius:4px; text-decoration:none;">✅ Approve</a></td>
                </tr>
            `).join('') || '<tr><td colspan="5">No pending requests</td></tr>';

            let studentRows = allStudents.map(st => `
                <tr>
                    <td>${st.student_id}</td><td>${st.name} ${st.father_name}</td><td>${st.department}</td><td>${st.class_level}</td>
                    <td>${st.total !== null ? st.total + ' (' + st.remark + ')' : 'Not Graded'}</td>
                    <td><a href="/download-id-pdf/${st.student_id}" style="background:#8e44ad; color:white; padding:4px 8px; border-radius:4px; text-decoration:none;">📥 PDF ID</a></td>
                </tr>
            `).join('') || '<tr><td colspan="6">No students found</td></tr>';

            res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head><meta charset="UTF-8"><title>Admin Dashboard</title>
            <style>body { font-family: sans-serif; background: #eef2f5; padding: 20px; } .card { background: white; padding: 20px; border-radius: 10px; margin-bottom: 20px; } table { width: 100%; border-collapse: collapse; margin-top: 10px; } th, td { border: 1px solid #ddd; padding: 8px; text-align: center; } th { background: #34495e; color: white; }</style>
            </head>
            <body>
                <h2>🔐 ADMIN SEARCH & CONTROL DASHBOARD</h2>
                <div class="card">
                    <form action="/admin" method="GET">
                        <input type="text" name="search" placeholder="🔍 Search students by name or ID..." value="${req.query.search || ''}" style="width:70%; padding:10px; border-radius:5px; border:1px solid #ccc;">
                        <button type="submit" style="padding:10px 20px; background:#1f4e79; color:white; border:none; border-radius:5px; cursor:pointer;">Search</button>
                        <a href="/admin" style="margin-left:10px; text-decoration:none;">Reset</a>
                    </form>
                </div>
                <div class="card">
                    <h3>📥 Pending Student Registrations</h3>
                    <table><thead><tr><th>ID</th><th>Name</th><th>Phone</th><th>Class</th><th>Action</th></tr></thead><tbody>${pendingRows}</tbody></table>
                </div>
                <div class="card">
                    <h3>👥 Enrolled Students & Grades</h3>
                    <table><thead><tr><th>ID</th><th>Full Name</th><th>Department</th><th>Class</th><th>Total Grade</th><th>Action</th></tr></thead><tbody>${studentRows}</tbody></table>
                </div>
                <a href="/logout" style="color:red; font-weight:bold;">🔒 Logout</a>
            </body>
            </html>
            `);
        });
    });
});

// ADMIN APPROVE STUDENT
app.get('/admin/approve-student/:id', (req, res) => {
    if (!req.session.isAdminLoggedIn) return res.redirect('/');
    const id = req.params.id;

    db.get(`SELECT * FROM pending_students WHERE id = ?`, [id], (err, st) => {
        if (!st) return res.redirect('/admin');

        db.run(`INSERT INTO students (student_id, password, name, father_name, mother_name, gender, age, phone, emergency_phone, region, zone, woreda, kebele, department, class_level, payment_type, bank_slip_val, photo, status, admin_message) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [st.student_id, st.password, st.name, st.father_name, st.mother_name, st.gender, st.age, st.phone, st.emergency_phone, st.region, st.zone, st.woreda, st.kebele, st.department, st.class_level, st.payment_type, st.bank_slip_val, st.photo, 'Approved', '🎉 Congratulations! Your registration has been approved.'], () => {
            db.run(`DELETE FROM pending_students WHERE id = ?`, [id], () => {
                res.redirect('/admin');
            });
        });
    });
});

// DIGITAL ID PDF
app.get('/download-id-pdf/:id', (req, res) => {
    db.get(`SELECT * FROM students WHERE student_id = ?`, [req.params.id], (err, student) => {
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
        if (fs.existsSync(photoFile)) doc.image(photoFile, 20, 60, { width: 80, height: 95 });

        doc.fontSize(10).fillColor('#000');
        doc.text(`Full Name: ${student.name} ${student.father_name}`, 115, 60);
        doc.text(`ID Number: ${student.student_id}`, 115, 78, { bold: true });
        doc.text(`Department: ${student.department}`, 115, 96);
        doc.text(`Class/Section: ${student.class_level}`, 115, 114);
        doc.text(`Phone: ${student.phone}`, 115, 132);
        doc.end();
    });
});

// STUDENT DASHBOARD
app.get('/student-dashboard', (req, res) => {
    if (!req.session.studentId) return res.redirect('/');
    db.get(`SELECT s.*, a.quiz, a.mid, a.final, a.total, a.remark FROM students s LEFT JOIN assessments a ON s.student_id = a.student_id WHERE s.student_id = ?`, [req.session.studentId], (err, student) => {
        if (!student) return res.redirect('/');
        let monitor = sectionMonitors[student.class_level] || { name: "Not assigned", phone: "-" };

        res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head><meta charset="UTF-8"><title>Student Dashboard</title>
        <style>body { font-family: sans-serif; background: #f4f7f6; padding: 20px; } .container { max-width: 600px; margin: auto; background: white; padding: 25px; border-radius: 12px; }</style>
        </head>
        <body>
            <div class="container">
                <h2>🎓 Student Dashboard</h2>
                <div style="background:#d4edda; color:#155724; padding:15px; border-radius:8px; margin-bottom:15px;">${student.admin_message}</div>
                <h3>${student.name} (${student.student_id})</h3>
                <p><strong>Class:</strong> ${student.class_level}</p>
                <p><strong>Department:</strong> ${student.department}</p>
                <p><strong>Class Monitor:</strong> ${monitor.name} (${monitor.phone})</p>
                <div style="background:#eef2f5; padding:15px; border-radius:8px; margin-top:15px;">
                    <h4>📊 Grade Status</h4>
                    <p>Quiz: ${student.quiz || 0} | Mid: ${student.mid || 0} | Final: ${student.final || 0}</p>
                    <p><strong>Total:</strong> ${student.total || 0} / 100 (${student.remark || 'Not Graded'})</p>
                </div><br>
                <a href="/download-id-pdf/${student.student_id}" style="background:#27ae60; color:white; padding:10px 18px; text-decoration:none; border-radius:6px; font-weight:bold;">📥 Download Digital ID</a>
                <br><br><a href="/logout" style="color:red; font-weight:bold;">🔒 Logout</a>
            </div>
        </body>
        </html>
        `);
    });
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
EOF
