const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const sqlite3 = require('sqlite3').verbose();
const bwipjs = require('bwip-js'); // For Barcode Generation

const app = express();
const PORT = process.env.PORT || 3000;

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
        student_id TEXT PRIMARY KEY, password TEXT, name TEXT, father_name TEXT, mother_name TEXT,
        gender TEXT, age INTEGER, phone TEXT, emergency_phone TEXT, region TEXT, zone TEXT,
        woreda TEXT, kebele TEXT, department TEXT, class_level TEXT, payment_type TEXT,
        bank_slip_val TEXT, photo TEXT, status TEXT, admin_message TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS pending_students (
        id INTEGER PRIMARY KEY AUTOINCREMENT, student_id TEXT, password TEXT, name TEXT, father_name TEXT,
        mother_name TEXT, gender TEXT, age INTEGER, phone TEXT, emergency_phone TEXT, region TEXT,
        zone TEXT, woreda TEXT, kebele TEXT, department TEXT, class_level TEXT, payment_type TEXT,
        bank_slip_val TEXT, photo TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS teachers (
        id TEXT PRIMARY KEY, name TEXT, dept TEXT, password TEXT, phone TEXT, assigned_section TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS assessments (
        student_id TEXT PRIMARY KEY, quiz REAL, mid REAL, final REAL, total REAL, remark TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS withdrawals (
        id INTEGER PRIMARY KEY AUTOINCREMENT, student_id TEXT, reason TEXT, details TEXT, status TEXT, admin_reply TEXT
    )`);

    // Seed default teachers if table is empty
    db.get("SELECT COUNT(*) as count FROM teachers", (err, row) => {
        if (row && row.count === 0) {
            db.run(`INSERT INTO teachers (id, name, dept, password, phone, assigned_section) VALUES 
            ('T-101', 'Dr. Teshale Kebede', 'Statistics', '123456', '0911001122', '1st Year - Section A'),
            ('T-102', 'Abebech Bekele', 'Computer Science', '123456', '0922334455', '1st Year - Section B')`);
        }
    });
});

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname))
});
const upload = multer({ storage: storage, limits: { fileSize: 5 * 1024 * 1024 } });

app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static('uploads'));

app.use(session({
    secret: 'mwu-full-system-session-fix', resave: false, saveUninitialized: true, cookie: { maxAge: 3600000 }
}));

const ADMIN_USER = "amanuel";
const ADMIN_PASS = "1234";

let sectionMonitors = {
    "1st Year - Section A": { name: "Kefyalew Kebede", phone: "0912345678" },
    "1st Year - Section B": { name: "Chala Tesfaye", phone: "0987654321" }
};

const coursesDB = {
    "1st Year": [
        { code: "CS101", title: "Intro to Computer Science", cr: 3, teacher: "Abebech Bekele" },
        { code: "MATH101", title: "Applied Mathematics I", cr: 4, teacher: "Dr. Teshale Kebede" },
        { code: "ENG101", title: "Communicative English", cr: 3, teacher: "Mr. Dawit" }
    ]
};

function generateStudentID() { return `MWU-${Math.floor(1000 + Math.random() * 9000)}`; }
function generate4DigitPIN() { return Math.floor(1000 + Math.random() * 9000).toString(); }

function assignClassSection(requestedYearLevel, callback) {
    const letters = ["A", "B", "C", "D"];
    let checkNext = (index) => {
        if (index >= letters.length) return callback(`${requestedYearLevel} - Section Overflow`);
        let secName = `${requestedYearLevel} - Section ${letters[index]}`;
        db.get(`SELECT COUNT(*) as c FROM students WHERE class_level = ?`, [secName], (err, r1) => {
            db.get(`SELECT COUNT(*) as c FROM pending_students WHERE class_level = ?`, [secName], (err, r2) => {
                let total = (r1 ? r1.c : 0) + (r2 ? r2.c : 0);
                if (total < 50) callback(secName);
                else checkNext(index + 1);
            });
        });
    };
    checkNext(0);
}

// LANDING PAGE
app.get('/', (req, res) => {
    const lang = req.query.lang === 'en' ? 'en' : 'am';
    const t = lang === 'en' ? {
        title: "🎓 MWU DIGITAL PORTAL", stud: "Student", teach: "Teacher", admin: "Admin",
        id: "ID Number / Username", pass: "Password PIN", btn: "Log In", reg: "📝 New Student Registration",
        forgot: "Forgot Password? Please contact the Admin."
    } : {
        title: "🎓 የመዳ ወላቡ ዩኒቨርሲቲ ፖርታል", stud: "ተማሪ (Student)", teach: "መምህር (Teacher)", admin: "አድሚን (Admin)",
        id: "መታወቂያ ቁጥር (ID)", pass: "የሚስጥር ቁጥር (Password)", btn: "ግባ (Log In)", reg: "📝 አዲስ ተማሪ ምዝገባ",
        forgot: "የይለፍ ቃል ከረሱ አድሚኑን ያነጋግሩ።"
    };

    res.send(`
    <!DOCTYPE html><html lang="${lang}"><head><meta charset="UTF-8"><title>MWU Portal</title>
    <style>body{font-family:sans-serif; background:#f4f7f6; padding:20px;} .box{max-width:400px; margin:auto; background:white; padding:30px; border-radius:10px; box-shadow:0 4px 10px rgba(0,0,0,0.1); text-align:center;} input,select,button{width:100%; padding:12px; margin-bottom:15px; border-radius:5px; border:1px solid #ccc; font-size:16px;} button{background:#1f4e79; color:white; font-weight:bold; cursor:pointer;} .reg-btn{display:block; background:#27ae60; color:white; padding:12px; text-decoration:none; border-radius:5px; font-weight:bold;}</style>
    </head><body>
        <div class="box">
            <div style="text-align:right;"><a href="/?lang=am">አማርኛ</a> | <a href="/?lang=en">English</a></div>
            <h2>${t.title}</h2>
            <form action="/login?lang=${lang}" method="POST">
                <select name="role"><option value="student">${t.stud}</option><option value="teacher">${t.teach}</option><option value="admin">${t.admin}</option></select>
                <input type="text" name="username" placeholder="${t.id}" required>
                <input type="password" name="password" placeholder="${t.pass}" required>
                <button type="submit">${t.btn}</button>
            </form>
            <p style="font-size:13px; color:#d35400;">🔒 ${t.forgot}</p><hr>
            <a href="/student-register?lang=${lang}" class="reg-btn">${t.reg}</a>
        </div>
    </body></html>`);
});

// STUDENT REGISTRATION
app.get('/student-register', (req, res) => {
    const lang = req.query.lang === 'en' ? 'en' : 'am';
    const t = lang === 'en' ? {
        title: "📝 Student Registration Form", name: "Full Name:", fat: "Father's Name:", mot: "Mother's Name:",
        gen: "Gender:", m: "Male", f: "Female", age: "Age:", ph: "Phone:", eph: "Emergency:", reg: "Region:",
        zon: "Zone:", wor: "Woreda:", keb: "Kebele:", dep: "Department:", yr: "Year Level:",
        pic: "Passport Photo:", pay: "Payment Type:", t1: "Transaction ID", t2: "Upload Slip", btn: "Submit", back: "Back"
    } : {
        title: "📝 የተማሪዎች ምዝገባ ፎርም", name: "ሙሉ ስም:", fat: "የአባት ስም:", mot: "የእናት ስም:",
        gen: "ጾታ:", m: "ወንድ", f: "ሴት", age: "ዕድሜ:", ph: "ስልክ:", eph: "የአደጋ ጊዜ ተጠሪ:", reg: "ክልል:",
        zon: "ዞን:", wor: "ወረዳ:", keb: "ቀበሌ:", dep: "ዲፓርትመንት:", yr: "የአካዳሚክ ዓመት:",
        pic: "ጉርድ ፎቶ:", pay: "የክፍያ ማረጋገጫ:", t1: "የትራንዛክሽን ቁጥር", t2: "የደረሰኝ ፎቶ ያያይዙ", btn: "ምዝገባ ላክ", back: "ተመለስ"
    };

    res.send(`
    <!DOCTYPE html><html lang="${lang}"><head><meta charset="UTF-8"><title>Registration</title>
    <style>body{font-family:sans-serif; background:#eef2f5; padding:15px;} .box{max-width:600px; margin:auto; background:white; padding:25px; border-radius:10px;} input,select{width:100%; padding:10px; margin:5px 0 15px; border:1px solid #ccc; border-radius:5px;} .row{display:flex; gap:10px;} .col{flex:1;} button{width:100%; padding:12px; background:#27ae60; color:white; font-weight:bold; border:none; border-radius:5px;}</style>
    </head><body>
        <div class="box">
            <div style="text-align:right;"><a href="/student-register?lang=am">አማርኛ</a> | <a href="/student-register?lang=en">English</a></div>
            <h2>${t.title}</h2>
            <form action="/api/register?lang=${lang}" method="POST" enctype="multipart/form-data">
                <label>${t.name}</label><input type="text" name="name" required>
                <div class="row"><div class="col"><label>${t.fat}</label><input type="text" name="father_name" required></div><div class="col"><label>${t.mot}</label><input type="text" name="mother_name" required></div></div>
                <div class="row"><div class="col"><label>${t.gen}</label><select name="gender"><option value="Male">${t.m}</option><option value="Female">${t.f}</option></select></div><div class="col"><label>${t.age}</label><input type="number" name="age" required></div></div>
                <div class="row"><div class="col"><label>${t.ph}</label><input type="text" name="phone" required></div><div class="col"><label>${t.eph}</label><input type="text" name="emergency_phone" required></div></div>
                <div class="row"><div class="col"><label>${t.reg}</label><input type="text" name="region" required></div><div class="col"><label>${t.zon}</label><input type="text" name="zone" required></div></div>
                <div class="row"><div class="col"><label>${t.wor}</label><input type="text" name="woreda" required></div><div class="col"><label>${t.keb}</label><input type="text" name="kebele" required></div></div>
                <label>${t.dep}</label><input type="text" name="department" required>
                <label>${t.yr}</label><select name="year_level"><option value="1st Year">1st Year</option><option value="2nd Year">2nd Year</option></select>
                <label>${t.pic}</label><input type="file" name="student_photo" accept="image/*" required>
                <label>${t.pay}</label><select name="payment_type" id="payType" onchange="document.getElementById('slipBox').style.display = this.value=='slip_file'?'block':'none'; document.getElementById('txnBox').style.display = this.value=='txn_id'?'block':'none';">
                    <option value="txn_id">${t.t1}</option><option value="slip_file">${t.t2}</option>
                </select>
                <div id="txnBox"><input type="text" name="txn_id" placeholder="Transaction ID"></div>
                <div id="slipBox" style="display:none;"><input type="file" name="bank_slip_file" accept="image/*,.pdf"></div>
                <button type="submit">${t.btn}</button>
            </form><br><a href="/?lang=${lang}">${t.back}</a>
        </div>
    </body></html>`);
});

app.post('/api/register', upload.fields([{ name: 'student_photo', maxCount: 1 }, { name: 'bank_slip_file', maxCount: 1 }]), (req, res) => {
    const lang = req.query.lang || 'am';
    let { name, father_name, mother_name, gender, age, phone, emergency_phone, region, zone, woreda, kebele, department, year_level, payment_type, txn_id } = req.body;
    let autoID = generateStudentID(); let autoPIN = generate4DigitPIN();

    assignClassSection(year_level, (assignedSection) => {
        let photoPath = req.files['student_photo'] ? req.files['student_photo'][0].filename : '';
        let slipPath = payment_type === 'slip_file' && req.files['bank_slip_file'] ? req.files['bank_slip_file'][0].filename : txn_id;

        db.run(`INSERT INTO pending_students (student_id, password, name, father_name, mother_name, gender, age, phone, emergency_phone, region, zone, woreda, kebele, department, class_level, payment_type, bank_slip_val, photo) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [autoID, autoPIN, name, father_name, mother_name, gender, age, phone, emergency_phone, region, zone, woreda, kebele, department, assignedSection, payment_type, slipPath, photoPath], function() {
            res.send(`
            <div style="text-align:center; padding:40px; font-family:sans-serif;">
                <h2 style="color:green;">✅ ${lang==='en'?"Request Sent!":"ጥያቄዎ ተልኳል!"}</h2>
                <div style="background:#eef2f5; display:inline-block; padding:20px; border-radius:8px; text-align:left;">
                    <p><strong>Class:</strong> ${assignedSection}</p>
                    <p><strong>ID Number:</strong> <span style="color:red; font-size:20px;">${autoID}</span></p>
                    <p><strong>Password PIN:</strong> <span style="color:red; font-size:20px;">${autoPIN}</span></p>
                    <p><a href="/download-pending-slip/${this.lastID}" style="background:#e67e22; color:white; padding:10px; text-decoration:none; border-radius:5px;">📥 Download Slip PDF</a></p>
                </div><br><br><a href="/?lang=${lang}">Home</a>
            </div>`);
        });
    });
});

app.get('/download-pending-slip/:id', (req, res) => {
    db.get(`SELECT * FROM pending_students WHERE id = ? UNION SELECT * FROM students WHERE student_id = ?`, [req.params.id, req.params.id], (err, st) => {
        if (!st) return res.send('Not found');
        const doc = new PDFDocument(); res.setHeader('Content-Type', 'application/pdf'); doc.pipe(res);
        doc.fontSize(20).text('MADDA WALABU UNIVERSITY', { align: 'center' }).moveDown();
        doc.fontSize(14).text(`Registration Slip`, { align: 'center' }).moveDown();
        doc.fontSize(12).text(`ID: ${st.student_id}`).text(`PIN: ${st.password}`).text(`Name: ${st.name} ${st.father_name}`).text(`Class: ${st.class_level}`);
        doc.end();
    });
});

// LOGIN
app.post('/login', (req, res) => {
    const lang = req.query.lang || 'am';
    const { role, username, password } = req.body;
    const uKey = username.trim();

    if (role === 'admin' && uKey === ADMIN_USER && password === ADMIN_PASS) {
        req.session.isAdmin = true; return res.redirect('/admin');
    } else if (role === 'teacher') {
        db.get(`SELECT * FROM teachers WHERE id = ? AND password = ?`, [uKey.toUpperCase(), password], (err, t) => {
            if (t) { req.session.teacherId = t.id; return res.redirect('/teacher-dashboard'); }
            res.send(`<h3 style="color:red; text-align:center; margin-top:50px;">❌ Invalid <a href="/?lang=${lang}">Back</a></h3>`);
        });
    } else if (role === 'student') {
        db.get(`SELECT * FROM students WHERE student_id = ? AND password = ?`, [uKey.toUpperCase(), password], (err, s) => {
            if (s) { req.session.studentId = s.student_id; return res.redirect('/student-dashboard'); }
            res.send(`<h3 style="color:red; text-align:center; margin-top:50px;">❌ Invalid or not approved. <a href="/?lang=${lang}">Back</a></h3>`);
        });
    }
});

// ADMIN DASHBOARD
app.get('/admin', (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/');
    
    db.all(`SELECT * FROM pending_students`, [], (err, pending) => {
        db.all(`SELECT * FROM students ORDER BY class_level`, [], (err, students) => {
            db.all(`SELECT * FROM teachers`, [], (err, teachers) => {
                db.all(`SELECT * FROM withdrawals`, [], (err, withdrawals) => {
                    
                    let pRows = pending.map(s => `<tr><td><img src="/uploads/${s.photo}" width="30"></td><td>${s.student_id}</td><td>${s.name}</td><td>${s.payment_type}: ${s.bank_slip_val}</td><td><a href="/admin/approve/${s.id}" style="color:green; font-weight:bold;">✅ Approve</a></td></tr>`).join('');
                    let sRows = students.map(s => `<tr><td>${s.student_id}</td><td>${s.name}</td><td>${s.class_level}</td><td><strong>${s.password}</strong></td>
                        <td><form action="/admin/update-pass" method="POST" style="display:inline;"><input type="hidden" name="type" value="student"><input type="hidden" name="id" value="${s.student_id}"><input type="text" name="new_pass" placeholder="New PIN" style="width:70px;"><button type="submit">Update</button></form></td></tr>`).join('');
                    let tRows = teachers.map(t => `<tr><td>${t.id}</td><td>${t.name}</td><td>${t.assigned_section}</td><td><strong>${t.password}</strong></td>
                        <td><form action="/admin/update-pass" method="POST" style="display:inline;"><input type="hidden" name="type" value="teacher"><input type="hidden" name="id" value="${t.id}"><input type="text" name="new_pass" placeholder="New Pass" style="width:70px;"><button type="submit">Update</button></form></td></tr>`).join('');
                    let wRows = withdrawals.map(w => `<tr><td>${w.student_id}</td><td>${w.reason}</td><td>${w.details}</td><td>${w.status}</td>
                        <td><form action="/admin/withdraw-reply" method="POST"><input type="hidden" name="id" value="${w.id}"><input type="text" name="reply" placeholder="Reply..."><select name="status"><option>Approved</option><option>Rejected</option></select><button type="submit">Save</button></form></td></tr>`).join('');

                    // Section Portals
                    let sections = [...new Set(students.map(s => s.class_level))];
                    let secLinks = sections.map(sec => `<a href="/admin/section/${encodeURIComponent(sec)}" style="display:inline-block; padding:10px; background:#3498db; color:white; text-decoration:none; border-radius:5px; margin:5px;">📂 ${sec}</a>`).join('');

                    res.send(`
                    <!DOCTYPE html><html><head><meta charset="UTF-8"><title>Admin</title>
                    <style>body{font-family:sans-serif; background:#eef2f5; padding:20px;} .card{background:white; padding:20px; border-radius:10px; margin-bottom:20px;} table{width:100%; border-collapse:collapse;} th,td{border:1px solid #ccc; padding:8px; text-align:center;} th{background:#2c3e50; color:white;}</style></head>
                    <body>
                        <h2>🔐 Admin Dashboard</h2>
                        <div class="card"><h3>1. Section Portals (መምህራን እና ተማሪዎች ያሉበት)</h3>${secLinks || 'No sections'}</div>
                        <div class="card"><h3>2. Pending Registrations</h3><table><tr><th>Photo</th><th>ID</th><th>Name</th><th>Payment</th><th>Action</th></tr>${pRows||'<tr><td colspan="5">None</td></tr>'}</table></div>
                        <div class="card"><h3>3. All Students (Password Management)</h3><table><tr><th>ID</th><th>Name</th><th>Class</th><th>Password</th><th>Change Password</th></tr>${sRows||'<tr><td colspan="5">None</td></tr>'}</table></div>
                        <div class="card"><h3>4. Teachers</h3><table><tr><th>ID</th><th>Name</th><th>Section</th><th>Password</th><th>Change Password</th></tr>${tRows}</table></div>
                        <div class="card"><h3>5. Withdrawal Requests</h3><table><tr><th>Student ID</th><th>Reason</th><th>Details</th><th>Status</th><th>Admin Action</th></tr>${wRows||'<tr><td colspan="5">None</td></tr>'}</table></div>
                        <a href="/logout" style="color:red; font-weight:bold;">🔒 Logout</a>
                    </body></html>`);
                });
            });
        });
    });
});

app.get('/admin/approve/:id', (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/');
    db.get(`SELECT * FROM pending_students WHERE id = ?`, [req.params.id], (err, st) => {
        db.run(`INSERT INTO students (student_id, password, name, father_name, mother_name, gender, age, phone, emergency_phone, region, zone, woreda, kebele, department, class_level, payment_type, bank_slip_val, photo, status, admin_message) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [st.student_id, st.password, st.name, st.father_name, st.mother_name, st.gender, st.age, st.phone, st.emergency_phone, st.region, st.zone, st.woreda, st.kebele, st.department, st.class_level, st.payment_type, st.bank_slip_val, st.photo, 'Approved', '🎉 Your registration is approved! Download your Digital ID.'], () => {
            db.run(`DELETE FROM pending_students WHERE id = ?`, [req.params.id], () => res.redirect('/admin'));
        });
    });
});

app.post('/admin/update-pass', (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/');
    let { type, id, new_pass } = req.body;
    let table = type === 'student' ? 'students' : 'teachers';
    let idCol = type === 'student' ? 'student_id' : 'id';
    db.run(`UPDATE ${table} SET password = ? WHERE ${idCol} = ?`, [new_pass, id], () => res.redirect('/admin'));
});

app.post('/admin/withdraw-reply', (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/');
    db.run(`UPDATE withdrawals SET admin_reply = ?, status = ? WHERE id = ?`, [req.body.reply, req.body.status, req.body.id], () => res.redirect('/admin'));
});

app.get('/admin/section/:secName', (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/');
    let sec = decodeURIComponent(req.params.secName);
    db.get(`SELECT * FROM teachers WHERE assigned_section = ?`, [sec], (err, teacher) => {
        db.all(`SELECT * FROM students WHERE class_level = ?`, [sec], (err, students) => {
            let monitor = sectionMonitors[sec] || { name: "Not Assigned" };
            let sRows = students.map(s => `<tr><td><img src="/uploads/${s.photo}" width="30"></td><td>${s.student_id}</td><td>${s.name}</td><td>${s.phone}</td></tr>`).join('');
            res.send(`
            <div style="font-family:sans-serif; padding:20px; background:#f4f7f6;">
                <a href="/admin" style="background:#7f8c8d; color:white; padding:8px 12px; text-decoration:none; border-radius:5px;">⬅️ Back to Admin</a>
                <h2>📂 Section Portal: ${sec}</h2>
                <div style="background:white; padding:15px; border-radius:8px; margin-bottom:15px; border-left:5px solid #1f4e79;">
                    <p><strong>👨‍🏫 Teacher:</strong> ${teacher ? teacher.name : 'N/A'} (${teacher ? teacher.phone : ''})</p>
                    <p><strong>👑 Monitor:</strong> ${monitor.name}</p>
                    <p><strong>👥 Total Students:</strong> ${students.length}</p>
                </div>
                <table border="1" width="100%" style="border-collapse:collapse; background:white; text-align:center;">
                    <tr style="background:#1f4e79; color:white;"><th>Photo</th><th>ID</th><th>Name</th><th>Phone</th></tr>
                    ${sRows||'<tr><td colspan="4">Empty</td></tr>'}
                </table>
            </div>`);
        });
    });
});

// TEACHER DASHBOARD
app.get('/teacher-dashboard', (req, res) => {
    if (!req.session.teacherId) return res.redirect('/');
    db.get(`SELECT * FROM teachers WHERE id = ?`, [req.session.teacherId], (err, teacher) => {
        db.all(`SELECT s.*, a.quiz, a.mid, a.final, a.total, a.remark FROM students s LEFT JOIN assessments a ON s.student_id = a.student_id WHERE s.class_level = ?`, [teacher.assigned_section], (err, rows) => {
            let studentRows = rows.map(st => `
                <tr><td>${st.student_id}</td><td>${st.name}</td>
                <form action="/teacher/save-grade" method="POST"><input type="hidden" name="student_id" value="${st.student_id}">
                <td><input type="number" name="quiz" value="${st.quiz||0}" min="0" max="20" style="width:50px;"></td>
                <td><input type="number" name="mid" value="${st.mid||0}" min="0" max="30" style="width:50px;"></td>
                <td><input type="number" name="final" value="${st.final||0}" min="0" max="50" style="width:50px;"></td>
                <td><strong>${st.total||0}</strong></td><td><button type="submit" style="background:#27ae60;color:white;border:none;padding:5px;">Save</button></td></form></tr>`).join('');
            res.send(`
            <div style="font-family:sans-serif; padding:20px; max-width:900px; margin:auto;">
                <h2>👨‍🏫 Teacher Portal: ${teacher.name} (${teacher.assigned_section})</h2>
                <table border="1" width="100%" style="border-collapse:collapse; text-align:center;">
                    <tr style="background:#1f4e79; color:white;"><th>ID</th><th>Name</th><th>Quiz(20)</th><th>Mid(30)</th><th>Final(50)</th><th>Total</th><th>Action</th></tr>
                    ${studentRows||'<tr><td colspan="7">No students</td></tr>'}
                </table><br><a href="/logout">Logout</a>
            </div>`);
        });
    });
});

app.post('/teacher/save-grade', (req, res) => {
    if (!req.session.teacherId) return res.redirect('/');
    let { student_id, quiz, mid, final } = req.body;
    let total = (parseFloat(quiz)||0) + (parseFloat(mid)||0) + (parseFloat(final)||0);
    db.run(`INSERT INTO assessments (student_id, quiz, mid, final, total, remark) VALUES (?,?,?,?,?,?) ON CONFLICT(student_id) DO UPDATE SET quiz=?, mid=?, final=?, total=?, remark=?`,
    [student_id, quiz, mid, final, total, total>=50?'Pass':'Fail', quiz, mid, final, total, total>=50?'Pass':'Fail'], () => res.redirect('/teacher-dashboard'));
});

// STUDENT DASHBOARD
app.get('/student-dashboard', (req, res) => {
    if (!req.session.studentId) return res.redirect('/');
    const lang = req.query.lang || 'am';
    
    db.get(`SELECT s.*, a.quiz, a.mid, a.final, a.total, a.remark FROM students s LEFT JOIN assessments a ON s.student_id = a.student_id WHERE s.student_id = ?`, [req.session.studentId], (err, student) => {
        db.all(`SELECT * FROM withdrawals WHERE student_id = ?`, [student.student_id], (err, wRecs) => {
            let monitor = sectionMonitors[student.class_level] || { name: "N/A", phone: "-" };
            let courses = coursesDB["1st Year"].map(c => `<tr><td>${c.code}</td><td>${c.title}</td><td>${c.cr}</td><td>${c.teacher}</td></tr>`).join('');
            let wHistory = wRecs.map(w => `<p>📝 <b>Reason:</b> ${w.reason} | <b>Status:</b> <span style="color:${w.status==='Approved'?'green':'orange'}">${w.status}</span> | <b>Admin Reply:</b> ${w.admin_reply||'Pending'}</p>`).join('');

            res.send(`
            <!DOCTYPE html><html lang="${lang}"><head><meta charset="UTF-8"><title>Student Dashboard</title>
            <style>body{font-family:sans-serif; background:#f4f7f6; padding:20px;} .container{max-width:800px; margin:auto;} .card{background:white; padding:20px; border-radius:10px; margin-bottom:20px; box-shadow:0 2px 5px rgba(0,0,0,0.1);} table{width:100%; border-collapse:collapse; margin-top:10px;} th,td{border:1px solid #ccc; padding:8px; text-align:center;} th{background:#1f4e79; color:white;}</style></head>
            <body>
                <div class="container">
                    <div style="text-align:right;"><a href="/student-dashboard?lang=am">አማርኛ</a> | <a href="/student-dashboard?lang=en">English</a></div>
                    <h2>🎓 Student Dashboard</h2>
                    <div class="card" style="background:#d4edda; color:#155724;">📢 <b>Admin Message:</b> ${student.admin_message}</div>
                    
                    <div class="card" style="display:flex; gap:20px; align-items:center;">
                        <img src="/uploads/${student.photo}" style="width:100px; height:120px; object-fit:cover; border-radius:5px;">
                        <div>
                            <h3>${student.name} (${student.student_id})</h3>
                            <p><b>Class:</b> ${student.class_level} | <b>Monitor:</b> ${monitor.name} (${monitor.phone})</p>
                            <a href="/download-id-pdf/${student.student_id}" style="display:inline-block; padding:10px; background:#27ae60; color:white; text-decoration:none; border-radius:5px; font-weight:bold;">📥 Download Digital ID w/ Barcode</a>
                        </div>
                    </div>

                    <div class="card">
                        <h3>📚 Registered Courses (Current Semester)</h3>
                        <table><tr><th>Code</th><th>Course Title</th><th>Cr.Hr</th><th>Instructor</th></tr>${courses}</table>
                    </div>

                    <div class="card">
                        <h3>📊 Assessment & Grades</h3>
                        <table><tr><th>Quiz (20%)</th><th>Mid (30%)</th><th>Final (50%)</th><th>Total (100%)</th><th>Remark</th></tr>
                        <tr><td>${student.quiz||'-'}</td><td>${student.mid||'-'}</td><td>${student.final||'-'}</td><td><strong>${student.total||'-'}</strong></td><td>${student.remark||'Not Graded'}</td></tr></table>
                    </div>

                    <div class="card" style="background:#fdf2e9;">
                        <h3>⚠️ Course/University Withdrawal Request</h3>
                        ${wHistory}
                        <form action="/student/withdraw" method="POST">
                            <select name="reason" style="width:100%; padding:10px; margin-bottom:10px;"><option>Medical Issue</option><option>Financial Issue</option><option>Other</option></select>
                            <textarea name="details" placeholder="Explain your case here..." style="width:100%; padding:10px; margin-bottom:10px;" rows="3" required></textarea>
                            <button type="submit" style="background:#e67e22; color:white; padding:10px; border:none; border-radius:5px; width:100%; cursor:pointer;">Submit Withdrawal Request to Admin</button>
                        </form>
                    </div>
                    <a href="/logout" style="color:red; font-weight:bold;">🔒 Logout</a>
                </div>
            </body></html>`);
        });
    });
});

app.post('/student/withdraw', (req, res) => {
    if (!req.session.studentId) return res.redirect('/');
    db.run(`INSERT INTO withdrawals (student_id, reason, details, status) VALUES (?,?,?,?)`, [req.session.studentId, req.body.reason, req.body.details, 'Pending'], () => res.redirect('/student-dashboard'));
});

// DIGITAL ID PDF (WITH PHOTO & BARCODE)
app.get('/download-id-pdf/:id', (req, res) => {
    db.get(`SELECT * FROM students WHERE student_id = ?`, [req.params.id], (err, student) => {
        if (!student) return res.send('Student not found');

        const doc = new PDFDocument({ size: [400, 260], margin: 15 });
        res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename=ID-${student.student_id}.pdf`);
        doc.pipe(res);

        doc.rect(10, 10, 380, 240).lineWidth(2).strokeColor('#1f4e79').fillAndStroke('#fdfefe', '#1f4e79');
        doc.fontSize(12).fillColor('#1f4e79').text('MADDA WALABU UNIVERSITY', 20, 20, { align: 'center', bold: true });
        doc.fontSize(9).fillColor('#e74c3c').text('OFFICIAL DIGITAL STUDENT ID CARD', 20, 35, { align: 'center' });
        doc.moveTo(20, 50).lineTo(380, 50).strokeColor('#ccc').stroke();

        let photoFile = path.join(__dirname, 'uploads', student.photo);
        if (fs.existsSync(photoFile)) doc.image(photoFile, 20, 60, { width: 80, height: 95 });

        doc.fontSize(10).fillColor('#000');
        doc.text(`Name: ${student.name} ${student.father_name}`, 115, 60);
        doc.text(`ID No: ${student.student_id}`, 115, 78, { bold: true });
        doc.text(`Dept: ${student.department}`, 115, 96);
        doc.text(`Class: ${student.class_level}`, 115, 114);
        doc.text(`Phone: ${student.phone}`, 115, 132);

        // Generate Barcode
        bwipjs.toBuffer({ bcid: 'code128', text: student.student_id, scale: 3, height: 10, includetext: true, textxalign: 'center' }, function (err, png) {
            if (!err) doc.image(png, 150, 180, { width: 150 });
            doc.end();
        });
    });
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
EOF
