const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const sqlite3 = require('sqlite3').verbose();
const bwipjs = require('bwip-js'); // For Barcode Generation

process.on('uncaughtException', (err) => { console.error('CRITICAL ERROR:', err); });
process.on('unhandledRejection', (reason, p) => { console.error('UNHANDLED REJECTION:', reason); });

const app = express();
const PORT = process.env.PORT || 3000;

if (!fs.existsSync('./uploads')) {
    fs.mkdirSync('./uploads');
}

const dbFile = './mwu_portal.db';
const db = new sqlite3.Database(dbFile, (err) => {
    if (err) console.error('Database opening error: ', err.message);
    else console.log('Connected to SQLite Database.');
});

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

    db.run(`CREATE TABLE IF NOT EXISTS courses (
        id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT, title TEXT, credit_hours INTEGER,
        teacher_id TEXT, teacher_name TEXT, class_level TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS sections (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, monitor_name TEXT, monitor_phone TEXT
    )`);

    db.get("SELECT COUNT(*) as count FROM teachers", (err, row) => {
        if (row && row.count === 0) {
            db.run(`INSERT INTO teachers (id, name, dept, password, phone, assigned_section) VALUES 
            ('T-101', 'Dr. Teshale Kebede', 'Statistics', '123456', '0911001122', '1st Year - Section A'),
            ('T-102', 'Abebech Bekele', 'Computer Science', '123456', '0922334455', '1st Year - Section B')`);
        }
    });

    db.get("SELECT COUNT(*) as count FROM sections", (err, row) => {
        if (row && row.count === 0) {
            db.run(`INSERT INTO sections (name, monitor_name, monitor_phone) VALUES 
            ('1st Year - Section A', 'Kefyalew Kebede', '0912345678'),
            ('1st Year - Section B', 'Chala Tesfaye', '0987654321')`);
        }
    });
});

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname))
});
const upload = multer({ storage: storage, limits: { fileSize: 5 * 1024 * 1024 } });
const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static('uploads'));

app.use(session({
    secret: 'mwu-full-system-session-fix', resave: false, saveUninitialized: true, cookie: { maxAge: 3600000 }
}));

const ADMIN_USER = "amanuel";
const ADMIN_PASS = "1234";

function generateStudentID() { return `MWU-${Math.floor(1000 + Math.random() * 9000)}`; }
function generateTeacherID() { return `T-${Math.floor(100 + Math.random() * 900)}`; }
function generate4DigitPIN() { return Math.floor(1000 + Math.random() * 9000).toString(); }

function ensureSectionExists(secName) {
    db.run(`INSERT OR IGNORE INTO sections (name, monitor_name, monitor_phone) VALUES (?, '', '')`, [secName]);
}

function assignClassSection(requestedYearLevel, callback) {
    const letters = ["A", "B", "C", "D"];
    let checkNext = (index) => {
        if (index >= letters.length) return callback(`${requestedYearLevel} - Section Overflow`);
        let secName = `${requestedYearLevel} - Section ${letters[index]}`;
        db.get(`SELECT COUNT(*) as c FROM students WHERE class_level = ?`, [secName], (err, r1) => {
            db.get(`SELECT COUNT(*) as c FROM pending_students WHERE class_level = ?`, [secName], (err, r2) => {
                let total = (r1 ? r1.c : 0) + (r2 ? r2.c : 0);
                if (total < 50) { ensureSectionExists(secName); callback(secName); }
                else checkNext(index + 1);
            });
        });
    };
    checkNext(0);
}

function csvCell(v) {
    if (v === null || v === undefined) return '';
    let s = String(v).replace(/"/g, '""');
    if (s.search(/("|,|\n)/g) >= 0) s = `"${s}"`;
    return s;
}

function esc(v) { return v === null || v === undefined ? '' : String(v).replace(/"/g, '&quot;'); }

// LANDING PAGE
app.get('/', (req, res) => {
    const lang = req.query.lang === 'en' ? 'en' : 'am';
    const t = lang === 'en' ? {
        title: "🎓 MWU DIGITAL PORTAL", stud: "Student", teach: "Teacher", admin: "Admin",
        id: "ID Number / Username", pass: "Password PIN", btn: "Log In", reg: "📝 New Student Registration",
        forgot: "Forgot your password?", forgotBtn: "🔑 Reset My Password"
    } : {
        title: "🎓 የመዳ ወላቡ ዩኒቨርሲቲ ፖርታል", stud: "ተማሪ (Student)", teach: "መምህር (Teacher)", admin: "አድሚን (Admin)",
        id: "መታወቂያ ቁጥር (ID)", pass: "የሚስጥር ቁጥር (Password)", btn: "ግባ (Log In)", reg: "📝 አዲስ ተማሪ ምዝገባ",
        forgot: "የይለፍ ቃልዎን ረሱ?", forgotBtn: "🔑 የይለፍ ቃል ዳግም አስጀምር"
    };

    res.send(`
    <!DOCTYPE html><html lang="${lang}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>MWU Portal</title>
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
            <p style="font-size:13px; color:#666;">${t.forgot} <a href="/forgot-password?lang=${lang}">${t.forgotBtn}</a></p><hr>
            <a href="/student-register?lang=${lang}" class="reg-btn">${t.reg}</a>
        </div>
    </body></html>`);
});

// ============== FORGOT PASSWORD ==============
app.get('/forgot-password', (req, res) => {
    const lang = req.query.lang === 'en' ? 'en' : 'am';
    const t = lang === 'en' ? {
        title: "🔑 Reset My Password", desc: "Enter your phone number and your mother's name exactly as you registered them. We'll generate a new password PIN for you.",
        ph: "Phone Number", mom: "Mother's Name", btn: "Reset Password", back: "Back to Login"
    } : {
        title: "🔑 የይለፍ ቃል ዳግም አስጀምር", desc: "በምዝገባ ጊዜ የተጠቀሙበትን ስልክ ቁጥር እና የእናትዎን ስም በትክክል ያስገቡ። አዲስ የይለፍ ቁጥር እናዘጋጅልዎታለን።",
        ph: "ስልክ ቁጥር", mom: "የእናት ስም", btn: "የይለፍ ቃል ዳግም አስጀምር", back: "ወደ መግቢያ ተመለስ"
    };
    res.send(`
    <!DOCTYPE html><html lang="${lang}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Reset Password</title>
    <style>body{font-family:sans-serif; background:#f4f7f6; padding:20px;} .box{max-width:400px; margin:auto; background:white; padding:30px; border-radius:10px; box-shadow:0 4px 10px rgba(0,0,0,0.1); text-align:center;} input,button{width:100%; padding:12px; margin-bottom:15px; border-radius:5px; border:1px solid #ccc; font-size:16px;} button{background:#8e44ad; color:white; font-weight:bold; cursor:pointer; border:none;}</style>
    </head><body>
        <div class="box">
            <h2>${t.title}</h2>
            <p style="color:#666; font-size:14px;">${t.desc}</p>
            <form action="/api/forgot-password?lang=${lang}" method="POST">
                <input type="text" name="phone" placeholder="${t.ph}" required>
                <input type="text" name="mother_name" placeholder="${t.mom}" required>
                <button type="submit">${t.btn}</button>
            </form>
            <a href="/?lang=${lang}">${t.back}</a>
        </div>
    </body></html>`);
});

app.post('/api/forgot-password', (req, res) => {
    const lang = req.query.lang || 'am';
    const { phone, mother_name } = req.body;
    const t = lang === 'en' ? {
        found: "✅ Password Reset!", pinLbl: "Your new Password PIN is:", note: "Use your existing ID Number together with this new PIN to log in.",
        notFound: "❌ No matching account found. Please check your phone number and mother's name, or contact the Admin.", back: "Back"
    } : {
        found: "✅ የይለፍ ቃል ዳግም ተጀምሯል!", pinLbl: "አዲሱ የይለፍ ቁጥርዎ:", note: "ነባሩን መታወቂያ ቁጥርዎን ከዚህ አዲስ ቁጥር ጋር በመጠቀም ይግቡ።",
        notFound: "❌ ተመሳሳይ አካውንት አልተገኘም። እባክዎ ስልክ ቁጥርዎን እና የእናትዎን ስም በድጋሚ ያረጋግጡ ወይም አድሚኑን ያነጋግሩ።", back: "ተመለስ"
    };

    let newPin = generate4DigitPIN();
    db.get(`SELECT student_id FROM students WHERE phone = ? AND mother_name = ?`, [phone, mother_name], (err, s) => {
        if (s) {
            return db.run(`UPDATE students SET password = ? WHERE student_id = ?`, [newPin, s.student_id], () => {
                res.send(`<div style="text-align:center; padding:40px; font-family:sans-serif;">
                    <h2 style="color:green;">${t.found}</h2>
                    <p>${t.pinLbl} <span style="color:red; font-size:24px; font-weight:bold;">${newPin}</span></p>
                    <p style="color:#666; font-size:14px; max-width:400px; margin:auto;">${t.note}</p>
                    <br><a href="/?lang=${lang}">${t.back}</a></div>`);
            });
        }
        db.get(`SELECT id FROM pending_students WHERE phone = ? AND mother_name = ?`, [phone, mother_name], (err2, p) => {
            if (p) {
                return db.run(`UPDATE pending_students SET password = ? WHERE id = ?`, [newPin, p.id], () => {
                    res.send(`<div style="text-align:center; padding:40px; font-family:sans-serif;">
                        <h2 style="color:green;">${t.found}</h2>
                        <p>${t.pinLbl} <span style="color:red; font-size:24px; font-weight:bold;">${newPin}</span></p>
                        <p style="color:#666; font-size:14px; max-width:400px; margin:auto;">${t.note}</p>
                        <br><a href="/?lang=${lang}">${t.back}</a></div>`);
                });
            }
            res.send(`<div style="text-align:center; padding:40px; font-family:sans-serif;">
                <h3 style="color:red;">${t.notFound}</h3>
                <br><a href="/forgot-password?lang=${lang}">${t.back}</a></div>`);
        });
    });
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
    <!DOCTYPE html><html lang="${lang}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Registration</title>
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
            const t = lang === 'en' ? {
                sent: "Request Sent!", pending: "Your payment slip has been sent to the Admin for review. You will be able to log in once approved.",
                cls: "Class", idL: "ID Number", pinL: "Password PIN"
            } : {
                sent: "ጥያቄዎ ተልኳል!", pending: "የክፍያ ማረጋገጫዎ ለአድሚን ገምጋሚ ተልኳል። ሲፈቀድ መግባት ይችላሉ።",
                cls: "ክፍል", idL: "የመታወቂያ ቁጥር", pinL: "የሚስጥር ቁጥር"
            };
            res.send(`
            <div style="text-align:center; padding:40px; font-family:sans-serif;">
                <h2 style="color:green;">✅ ${t.sent}</h2>
                <div style="background:#eef2f5; display:inline-block; padding:20px; border-radius:8px; text-align:left;">
                    <p><strong>${t.cls}:</strong> ${assignedSection}</p>
                    <p><strong>${t.idL}:</strong> <span style="color:red; font-size:20px;">${autoID}</span></p>
                    <p><strong>${t.pinL}:</strong> <span style="color:red; font-size:20px;">${autoPIN}</span></p>
                    <p style="color:#e67e22; font-size:13px;">⏳ ${t.pending}</p>
                    <p><a href="/download-pending-slip/${this.lastID}" style="background:#e67e22; color:white; padding:10px; text-decoration:none; border-radius:5px;">📥 Download Full Registration PDF</a></p>
                </div><br><br><a href="/?lang=${lang}">Home</a>
            </div>`);
        });
    });
});

app.get('/download-pending-slip/:id', (req, res) => {
    db.get(`SELECT * FROM pending_students WHERE id = ? UNION SELECT * FROM students WHERE student_id = ?`, [req.params.id, req.params.id], (err, st) => {
        if (!st) return res.send('Not found');
        const doc = new PDFDocument({ margin: 40 });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Registration-${st.student_id}.pdf`);
        doc.pipe(res);

        doc.fontSize(20).fillColor('#1f4e79').text('MADDA WALABU UNIVERSITY', { align: 'center' });
        doc.fontSize(13).fillColor('#333').text('Student Registration Summary', { align: 'center' }).moveDown();
        doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#ccc').stroke().moveDown();

        let photoFile = path.join(__dirname, 'uploads', st.photo || '');
        let textStartX = 40;
        if (st.photo && fs.existsSync(photoFile)) {
            doc.image(photoFile, 420, doc.y, { width: 110, height: 130 });
        }

        const line = (label, val) => doc.fontSize(11).fillColor('#000').text(`${label}: `, textStartX, doc.y, { continued: true }).fillColor('#333').text(`${val || '-'}`);

        line('ID Number', st.student_id);
        line('Password PIN', st.password);
        line('Full Name', `${st.name || ''} ${st.father_name || ''} ${st.mother_name || ''}`);
        line('Gender', st.gender);
        line('Age', st.age);
        line('Phone', st.phone);
        line('Emergency Contact', st.emergency_phone);
        line('Region / Zone', `${st.region || ''} / ${st.zone || ''}`);
        line('Woreda / Kebele', `${st.woreda || ''} / ${st.kebele || ''}`);
        line('Department', st.department);
        line('Class / Section', st.class_level);
        line('Payment Type', st.payment_type);
        line('Payment Reference', st.bank_slip_val);
        line('Status', st.status || 'Pending Admin Approval');
        doc.moveDown(2);
        doc.fontSize(9).fillColor('#999').text('This document is auto-generated by the MWU Digital Portal.', { align: 'center' });
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

// ================= ADMIN DASHBOARD =================
app.get('/admin', (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/');

    db.all(`SELECT * FROM pending_students`, [], (err, pending) => {
        db.all(`SELECT * FROM students ORDER BY class_level`, [], (err, students) => {
            db.all(`SELECT * FROM teachers`, [], (err, teachers) => {
                db.all(`SELECT * FROM withdrawals`, [], (err, withdrawals) => {
                    db.all(`SELECT * FROM sections ORDER BY name`, [], (err, sections) => {
                        db.all(`SELECT * FROM courses ORDER BY class_level, code`, [], (err, courses) => {

                            let pRows = pending.map(s => `<tr><td><img src="/uploads/${s.photo}" width="30"></td><td>${s.student_id}</td><td>${s.name}</td><td>${s.payment_type}: ${s.bank_slip_val}</td><td><a href="/admin/approve/${s.id}" style="color:green; font-weight:bold;">✅ Approve</a></td></tr>`).join('');

                            let sRows = students.map(s => `<tr>
                                <td>${s.student_id}</td><td>${s.name}</td><td>${s.class_level}</td><td>${s.phone}</td><td>${s.status || ''}</td>
                                <td><a href="/admin/edit-student/${s.student_id}" style="color:#2980b9; font-weight:bold;">✏️ Edit</a></td>
                                <td><form action="/admin/update-pass" method="POST" style="display:flex; gap:4px;"><input type="hidden" name="type" value="student"><input type="hidden" name="id" value="${s.student_id}"><input type="text" name="new_pass" placeholder="New PIN" style="width:70px;"><button type="submit">Reset</button></form></td>
                                <td><a href="/admin/delete-student/${s.student_id}" onclick="return confirm('Delete this student permanently?')" style="color:red; font-weight:bold;">🗑️ Delete</a></td>
                                </tr>`).join('');

                            let tRows = teachers.map(t => `<tr>
                                <td>${t.id}</td><td>${t.name}</td><td>${t.dept}</td><td>${t.assigned_section}</td><td>${t.phone}</td>
                                <td><a href="/admin/edit-teacher/${t.id}" style="color:#2980b9; font-weight:bold;">✏️ Edit</a></td>
                                <td><form action="/admin/update-pass" method="POST" style="display:flex; gap:4px;"><input type="hidden" name="type" value="teacher"><input type="hidden" name="id" value="${t.id}"><input type="text" name="new_pass" placeholder="New Pass" style="width:70px;"><button type="submit">Reset</button></form></td>
                                <td><a href="/admin/delete-teacher/${t.id}" onclick="return confirm('Delete this teacher?')" style="color:red; font-weight:bold;">🗑️ Delete</a></td>
                                </tr>`).join('');

                            let wRows = withdrawals.map(w => `<tr><td>${w.student_id}</td><td>${w.reason}</td><td>${w.details}</td><td>${w.status}</td>
                                <td><form action="/admin/withdraw-reply" method="POST"><input type="hidden" name="id" value="${w.id}"><input type="text" name="reply" placeholder="Reply..."><select name="status"><option>Approved</option><option>Rejected</option></select><button type="submit">Save</button></form></td></tr>`).join('');

                            let secRows = sections.map(sec => `<tr>
                                <td>${sec.name}</td>
                                <td><form action="/admin/edit-section/${sec.id}" method="POST" style="display:flex; gap:4px;">
                                    <input type="text" name="monitor_name" value="${esc(sec.monitor_name)}" placeholder="Monitor Name" style="width:110px;">
                                    <input type="text" name="monitor_phone" value="${esc(sec.monitor_phone)}" placeholder="Monitor Phone" style="width:110px;">
                                    <button type="submit">Save</button></form></td>
                                <td><a href="/admin/delete-section/${sec.id}" onclick="return confirm('Delete this section?')" style="color:red; font-weight:bold;">🗑️ Delete</a></td>
                                <td><a href="/admin/section/${encodeURIComponent(sec.name)}" style="color:#16a085;">📂 Open Portal</a></td>
                                </tr>`).join('');

                            let sectionOptions = sections.map(sec => `<option value="${esc(sec.name)}">${sec.name}</option>`).join('');
                            let teacherOptions = teachers.map(t => `<option value="${t.id}">${t.name}</option>`).join('');

                            let cRows = courses.map(c => `<tr><td>${c.code}</td><td>${c.title}</td><td>${c.credit_hours}</td><td>${c.class_level}</td><td>${c.teacher_name||'-'}</td>
                                <td><a href="/admin/delete-course/${c.id}" onclick="return confirm('Delete this course?')" style="color:red; font-weight:bold;">🗑️ Delete</a></td></tr>`).join('');

                            let secLinks = sections.map(sec => `<a href="/admin/section/${encodeURIComponent(sec.name)}" style="display:inline-block; padding:10px; background:#3498db; color:white; text-decoration:none; border-radius:5px; margin:5px;">📂 ${sec.name}</a>`).join('');

                            res.send(`
                            <!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Admin</title>
                            <style>body{font-family:sans-serif; background:#eef2f5; padding:20px;} .card{background:white; padding:20px; border-radius:10px; margin-bottom:20px; overflow-x:auto;} table{width:100%; border-collapse:collapse; min-width:600px;} th,td{border:1px solid #ccc; padding:8px; text-align:center;} th{background:#2c3e50; color:white;} .btn{display:inline-block; padding:10px 14px; background:#16a085; color:white; text-decoration:none; border-radius:5px; font-weight:bold; margin-right:10px;} input,select{padding:6px;}</style></head>
                            <body>
                                <h2>🔐 Admin Dashboard</h2>
                                <div class="card"><h3>1. Section Portals</h3>${secLinks || 'No sections'}</div>

                                <div class="card"><h3>2. Pending Registrations</h3><table><tr><th>Photo</th><th>ID</th><th>Name</th><th>Payment</th><th>Action</th></tr>${pRows||'<tr><td colspan="5">None</td></tr>'}</table></div>

                                <div class="card">
                                    <h3>3. Manage Sections / Classes</h3>
                                    <form action="/admin/add-section" method="POST" style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:10px;">
                                        <input type="text" name="name" placeholder="Section Name (e.g. 2nd Year - Section A)" required style="flex:2;">
                                        <input type="text" name="monitor_name" placeholder="Monitor Name">
                                        <input type="text" name="monitor_phone" placeholder="Monitor Phone">
                                        <button type="submit" style="background:#2980b9; color:white; border:none; padding:8px 14px; border-radius:5px;">➕ Add Section</button>
                                    </form>
                                    <table><tr><th>Section Name</th><th>Monitor Info</th><th>Delete</th><th>Portal</th></tr>${secRows||'<tr><td colspan="4">None</td></tr>'}</table>
                                </div>

                                <div class="card">
                                    <h3>4. Manage Teachers</h3>
                                    <form action="/admin/add-teacher" method="POST" style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:10px;">
                                        <input type="text" name="name" placeholder="Full Name" required>
                                        <input type="text" name="dept" placeholder="Department" required>
                                        <input type="text" name="phone" placeholder="Phone" required>
                                        <select name="assigned_section">${sectionOptions}</select>
                                        <button type="submit" style="background:#2980b9; color:white; border:none; padding:8px 14px; border-radius:5px;">➕ Add Teacher</button>
                                    </form>
                                    <table><tr><th>ID</th><th>Name</th><th>Dept</th><th>Section</th><th>Phone</th><th>Edit</th><th>Reset Password</th><th>Delete</th></tr>${tRows||'<tr><td colspan="8">None</td></tr>'}</table>
                                </div>

                                <div class="card">
                                    <h3>5. Manage Courses (All Sections)</h3>
                                    <form action="/admin/add-course" method="POST" style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:10px;">
                                        <input type="text" name="code" placeholder="Course Code" required>
                                        <input type="text" name="title" placeholder="Course Title" required>
                                        <input type="number" name="credit_hours" placeholder="Cr.Hr" required style="width:80px;">
                                        <select name="class_level">${sectionOptions}</select>
                                        <select name="teacher_id"><option value="">-- No Teacher --</option>${teacherOptions}</select>
                                        <button type="submit" style="background:#2980b9; color:white; border:none; padding:8px 14px; border-radius:5px;">➕ Add Course</button>
                                    </form>
                                    <table><tr><th>Code</th><th>Title</th><th>Cr.Hr</th><th>Section</th><th>Teacher</th><th>Delete</th></tr>${cRows||'<tr><td colspan="6">None</td></tr>'}</table>
                                </div>

                                <div class="card">
                                    <h3>6. All Students</h3>
                                    <p><a class="btn" href="/admin/export-students">📊 Export All Students to Excel (CSV)</a></p>
                                    <form action="/admin/import-students" method="POST" enctype="multipart/form-data" style="margin-bottom:15px;">
                                        <label style="font-weight:bold;">➕ Add Students from Excel/CSV file:</label><br>
                                        <input type="file" name="csv_file" accept=".csv" required style="margin:8px 0;">
                                        <button type="submit" style="padding:8px 14px; background:#2980b9; color:white; border:none; border-radius:5px;">Upload & Add</button>
                                        <p style="font-size:12px; color:#888;">Columns (in order, no header row needed): name, father_name, mother_name, gender, age, phone, emergency_phone, region, zone, woreda, kebele, department, class_level</p>
                                    </form>
                                    <table><tr><th>ID</th><th>Name</th><th>Class</th><th>Phone</th><th>Status</th><th>Edit</th><th>Reset Password</th><th>Delete</th></tr>${sRows||'<tr><td colspan="8">None</td></tr>'}</table>
                                </div>

                                <div class="card"><h3>7. Withdrawal Requests</h3><table><tr><th>Student ID</th><th>Reason</th><th>Details</th><th>Status</th><th>Admin Action</th></tr>${wRows||'<tr><td colspan="5">None</td></tr>'}</table></div>
                                <br><a href="/logout" style="color:red; font-weight:bold; font-size:18px;">🔒 Logout</a>
                            </body></html>`);
                        });
                    });
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

// ---------- Student: full view/edit (everything except password) + delete ----------
app.get('/admin/edit-student/:id', (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/');
    db.get(`SELECT * FROM students WHERE student_id = ?`, [req.params.id], (err, s) => {
        if (!s) return res.send('Not found');
        db.all(`SELECT * FROM sections ORDER BY name`, [], (err, sections) => {
            let sectionOptions = sections.map(sec => `<option value="${esc(sec.name)}" ${sec.name===s.class_level?'selected':''}>${sec.name}</option>`).join('');
            const field = (label, name, val, type='text') => `<label>${label}</label><input type="${type}" name="${name}" value="${esc(val)}" style="width:100%; padding:8px; margin-bottom:10px;">`;
            res.send(`
            <div style="font-family:sans-serif; padding:20px; max-width:600px; margin:auto; background:white; border-radius:10px;">
                <h2>✏️ Edit Student: ${s.student_id}</h2>
                <form action="/admin/edit-student/${s.student_id}" method="POST">
                    ${field('Full Name','name',s.name)}
                    ${field("Father's Name",'father_name',s.father_name)}
                    ${field("Mother's Name",'mother_name',s.mother_name)}
                    <label>Gender</label><select name="gender" style="width:100%; padding:8px; margin-bottom:10px;"><option ${s.gender==='Male'?'selected':''}>Male</option><option ${s.gender==='Female'?'selected':''}>Female</option></select>
                    ${field('Age','age',s.age,'number')}
                    ${field('Phone','phone',s.phone)}
                    ${field('Emergency Phone','emergency_phone',s.emergency_phone)}
                    ${field('Region','region',s.region)}
                    ${field('Zone','zone',s.zone)}
                    ${field('Woreda','woreda',s.woreda)}
                    ${field('Kebele','kebele',s.kebele)}
                    ${field('Department','department',s.department)}
                    <label>Class / Section</label><select name="class_level" style="width:100%; padding:8px; margin-bottom:10px;">${sectionOptions}</select>
                    ${field('Status','status',s.status)}
                    ${field('Admin Message','admin_message',s.admin_message)}
                    <p style="font-size:12px; color:#888;">Note: Password cannot be viewed or edited here — use the Reset Password action on the Admin dashboard.</p>
                    <button type="submit" style="width:100%; padding:12px; background:#27ae60; color:white; border:none; border-radius:5px; font-weight:bold;">💾 Save Changes</button>
                </form><br><a href="/admin">⬅️ Back to Admin</a>
            </div>`);
        });
    });
});

app.post('/admin/edit-student/:id', (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/');
    let { name, father_name, mother_name, gender, age, phone, emergency_phone, region, zone, woreda, kebele, department, class_level, status, admin_message } = req.body;
    db.run(`UPDATE students SET name=?, father_name=?, mother_name=?, gender=?, age=?, phone=?, emergency_phone=?, region=?, zone=?, woreda=?, kebele=?, department=?, class_level=?, status=?, admin_message=? WHERE student_id=?`,
    [name, father_name, mother_name, gender, age, phone, emergency_phone, region, zone, woreda, kebele, department, class_level, status, admin_message, req.params.id], () => res.redirect('/admin'));
});

app.get('/admin/delete-student/:id', (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/');
    db.run(`DELETE FROM students WHERE student_id = ?`, [req.params.id], () => {
        db.run(`DELETE FROM assessments WHERE student_id = ?`, [req.params.id], () => {
            db.run(`DELETE FROM withdrawals WHERE student_id = ?`, [req.params.id], () => res.redirect('/admin'));
        });
    });
});

// ---------- Teachers: add / edit (everything except password) / delete ----------
app.post('/admin/add-teacher', (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/');
    let { name, dept, phone, assigned_section } = req.body;
    let newId = generateTeacherID();
    let newPass = generate4DigitPIN();
    db.run(`INSERT INTO teachers (id, name, dept, password, phone, assigned_section) VALUES (?,?,?,?,?,?)`,
    [newId, name, dept, newPass, phone, assigned_section], () => res.redirect('/admin'));
});

app.get('/admin/edit-teacher/:id', (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/');
    db.get(`SELECT * FROM teachers WHERE id = ?`, [req.params.id], (err, t) => {
        if (!t) return res.send('Not found');
        db.all(`SELECT * FROM sections ORDER BY name`, [], (err, sections) => {
            let sectionOptions = sections.map(sec => `<option value="${esc(sec.name)}" ${sec.name===t.assigned_section?'selected':''}>${sec.name}</option>`).join('');
            res.send(`
            <div style="font-family:sans-serif; padding:20px; max-width:500px; margin:auto; background:white; border-radius:10px;">
                <h2>✏️ Edit Teacher: ${t.id}</h2>
                <form action="/admin/edit-teacher/${t.id}" method="POST">
                    <label>Full Name</label><input type="text" name="name" value="${esc(t.name)}" style="width:100%; padding:8px; margin-bottom:10px;">
                    <label>Department</label><input type="text" name="dept" value="${esc(t.dept)}" style="width:100%; padding:8px; margin-bottom:10px;">
                    <label>Phone</label><input type="text" name="phone" value="${esc(t.phone)}" style="width:100%; padding:8px; margin-bottom:10px;">
                    <label>Assigned Section</label><select name="assigned_section" style="width:100%; padding:8px; margin-bottom:10px;">${sectionOptions}</select>
                    <p style="font-size:12px; color:#888;">Note: Password cannot be viewed or edited here — use Reset Password on the Admin dashboard.</p>
                    <button type="submit" style="width:100%; padding:12px; background:#27ae60; color:white; border:none; border-radius:5px; font-weight:bold;">💾 Save Changes</button>
                </form><br><a href="/admin">⬅️ Back to Admin</a>
            </div>`);
        });
    });
});

app.post('/admin/edit-teacher/:id', (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/');
    let { name, dept, phone, assigned_section } = req.body;
    db.run(`UPDATE teachers SET name=?, dept=?, phone=?, assigned_section=? WHERE id=?`,
    [name, dept, phone, assigned_section, req.params.id], () => res.redirect('/admin'));
});

app.get('/admin/delete-teacher/:id', (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/');
    db.run(`DELETE FROM teachers WHERE id = ?`, [req.params.id], () => res.redirect('/admin'));
});

// ---------- Sections: add / edit monitor info / delete ----------
app.post('/admin/add-section', (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/');
    let { name, monitor_name, monitor_phone } = req.body;
    db.run(`INSERT OR IGNORE INTO sections (name, monitor_name, monitor_phone) VALUES (?,?,?)`,
    [name, monitor_name || '', monitor_phone || ''], () => res.redirect('/admin'));
});

app.post('/admin/edit-section/:id', (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/');
    let { monitor_name, monitor_phone } = req.body;
    db.run(`UPDATE sections SET monitor_name=?, monitor_phone=? WHERE id=?`, [monitor_name, monitor_phone, req.params.id], () => res.redirect('/admin'));
});

app.get('/admin/delete-section/:id', (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/');
    db.run(`DELETE FROM sections WHERE id = ?`, [req.params.id], () => res.redirect('/admin'));
});

// ---------- Courses: add / delete (admin, any section) ----------
app.post('/admin/add-course', (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/');
    let { code, title, credit_hours, class_level, teacher_id } = req.body;
    if (teacher_id) {
        db.get(`SELECT name FROM teachers WHERE id = ?`, [teacher_id], (err, t) => {
            db.run(`INSERT INTO courses (code, title, credit_hours, teacher_id, teacher_name, class_level) VALUES (?,?,?,?,?,?)`,
            [code, title, credit_hours, teacher_id, t ? t.name : '', class_level], () => res.redirect('/admin'));
        });
    } else {
        db.run(`INSERT INTO courses (code, title, credit_hours, teacher_id, teacher_name, class_level) VALUES (?,?,?,?,?,?)`,
        [code, title, credit_hours, '', '', class_level], () => res.redirect('/admin'));
    }
});

app.get('/admin/delete-course/:id', (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/');
    db.run(`DELETE FROM courses WHERE id = ?`, [req.params.id], () => res.redirect('/admin'));
});

// ---------- Export / Import students ----------
app.get('/admin/export-students', (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/');
    db.all(`SELECT * FROM students ORDER BY class_level, name`, [], (err, students) => {
        let header = ['student_id','name','father_name','mother_name','gender','age','phone','emergency_phone','region','zone','woreda','kebele','department','class_level','payment_type','status'];
        let rows = [header.join(',')];
        students.forEach(s => rows.push(header.map(col => csvCell(s[col])).join(',')));
        let csv = rows.join('\r\n');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=mwu_students.csv');
        res.send(csv);
    });
});

app.post('/admin/import-students', csvUpload.single('csv_file'), (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/');
    if (!req.file) return res.redirect('/admin');

    let text = req.file.buffer.toString('utf8');
    let lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length && lines[0].toLowerCase().startsWith('name,')) lines.shift();

    let processRow = (i) => {
        if (i >= lines.length) return res.redirect('/admin');
        let cols = lines[i].split(',').map(c => c.trim());
        let [name, father_name, mother_name, gender, age, phone, emergency_phone, region, zone, woreda, kebele, department, class_level] = cols;
        if (!name) return processRow(i + 1);

        let autoID = generateStudentID();
        let autoPIN = generate4DigitPIN();
        let secName = class_level || 'Unassigned';
        ensureSectionExists(secName);
        db.run(`INSERT INTO students (student_id, password, name, father_name, mother_name, gender, age, phone, emergency_phone, region, zone, woreda, kebele, department, class_level, payment_type, bank_slip_val, photo, status, admin_message) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [autoID, autoPIN, name, father_name || '', mother_name || '', gender || '', age || null, phone || '', emergency_phone || '', region || '', zone || '', woreda || '', kebele || '', department || '', secName, 'admin_added', '-', '', 'Approved', 'Added directly by Admin.'],
        () => processRow(i + 1));
    };
    processRow(0);
});

app.get('/admin/section/:secName', (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/');
    let sec = decodeURIComponent(req.params.secName);
    db.get(`SELECT * FROM teachers WHERE assigned_section = ?`, [sec], (err, teacher) => {
        db.get(`SELECT * FROM sections WHERE name = ?`, [sec], (err, section) => {
            db.all(`SELECT * FROM students WHERE class_level = ?`, [sec], (err, students) => {
                let monitor = section || { monitor_name: "Not Assigned", monitor_phone: "" };
                let sRows = students.map(s => `<tr><td><img src="/uploads/${s.photo}" width="30"></td><td>${s.student_id}</td><td>${s.name}</td><td>${s.phone}</td></tr>`).join('');
                res.send(`
                <div style="font-family:sans-serif; padding:20px; background:#f4f7f6;">
                    <a href="/admin" style="background:#7f8c8d; color:white; padding:8px 12px; text-decoration:none; border-radius:5px;">⬅️ Back to Admin</a>
                    <h2>📂 Section Portal: ${sec}</h2>
                    <div style="background:white; padding:15px; border-radius:8px; margin-bottom:15px; border-left:5px solid #1f4e79;">
                        <p><strong>👨‍🏫 Teacher:</strong> ${teacher ? teacher.name : 'N/A'} (${teacher ? teacher.phone : ''})</p>
                        <p><strong>👑 Monitor:</strong> ${monitor.monitor_name || 'N/A'} (${monitor.monitor_phone || ''})</p>
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
});

// TEACHER DASHBOARD
app.get('/teacher-dashboard', (req, res) => {
    if (!req.session.teacherId) return res.redirect('/');
    db.get(`SELECT * FROM teachers WHERE id = ?`, [req.session.teacherId], (err, teacher) => {
        db.all(`SELECT s.*, a.quiz, a.mid, a.final, a.total, a.remark FROM students s LEFT JOIN assessments a ON s.student_id = a.student_id WHERE s.class_level = ?`, [teacher.assigned_section], (err, rows) => {
            db.all(`SELECT * FROM courses WHERE class_level = ? ORDER BY id DESC`, [teacher.assigned_section], (err, courses) => {

                let studentRows = rows.map(st => `
                    <tr><td>${st.student_id}</td><td>${st.name}</td>
                    <form action="/teacher/save-grade" method="POST"><input type="hidden" name="student_id" value="${st.student_id}">
                    <td><input type="number" name="quiz" value="${st.quiz||0}" min="0" max="20" style="width:50px;"></td>
                    <td><input type="number" name="mid" value="${st.mid||0}" min="0" max="30" style="width:50px;"></td>
                    <td><input type="number" name="final" value="${st.final||0}" min="0" max="50" style="width:50px;"></td>
                    <td><strong>${st.total||0}</strong></td><td><button type="submit" style="background:#27ae60;color:white;border:none;padding:5px;">Save</button></td></form></tr>`).join('');

                let courseRows = courses.map(c => `<tr><td>${c.code}</td><td>${c.title}</td><td>${c.credit_hours}</td></tr>`).join('');

                res.send(`
                <div style="font-family:sans-serif; padding:20px; max-width:900px; margin:auto;">
                    <h2>👨‍🏫 Teacher Portal: ${teacher.name} (${teacher.assigned_section})</h2>

                    <div style="background:white; padding:15px; border-radius:8px; margin-bottom:20px;">
                        <h3>📚 My Courses for ${teacher.assigned_section}</h3>
                        <table border="1" style="border-collapse:collapse; width:100%; text-align:center; margin-bottom:15px;">
                            <tr style="background:#1f4e79; color:white;"><th>Code</th><th>Title</th><th>Credit Hours</th></tr>
                            ${courseRows || '<tr><td colspan="3">No courses added yet</td></tr>'}
                        </table>
                        <form action="/teacher/add-course" method="POST" style="display:flex; gap:8px; flex-wrap:wrap;">
                            <input type="text" name="code" placeholder="Course Code (e.g. STAT201)" required style="flex:1; padding:8px;">
                            <input type="text" name="title" placeholder="Course Title" required style="flex:2; padding:8px;">
                            <input type="number" name="credit_hours" placeholder="Cr.Hr" required style="width:80px; padding:8px;">
                            <button type="submit" style="background:#2980b9; color:white; border:none; padding:8px 14px; border-radius:5px;">➕ Add Course</button>
                        </form>
                    </div>

                    <div style="overflow-x:auto;">
                    <table border="1" width="100%" style="border-collapse:collapse; text-align:center; min-width:600px; background:white;">
                        <tr style="background:#1f4e79; color:white;"><th>ID</th><th>Name</th><th>Quiz(20)</th><th>Mid(30)</th><th>Final(50)</th><th>Total</th><th>Action</th></tr>
                        ${studentRows||'<tr><td colspan="7">No students</td></tr>'}
                    </table></div><br><a href="/logout" style="color:red; font-weight:bold;">🔒 Logout</a>
                </div>`);
            });
        });
    });
});

app.post('/teacher/add-course', (req, res) => {
    if (!req.session.teacherId) return res.redirect('/');
    db.get(`SELECT * FROM teachers WHERE id = ?`, [req.session.teacherId], (err, teacher) => {
        let { code, title, credit_hours } = req.body;
        db.run(`INSERT INTO courses (code, title, credit_hours, teacher_id, teacher_name, class_level) VALUES (?,?,?,?,?,?)`,
        [code, title, credit_hours, teacher.id, teacher.name, teacher.assigned_section], () => res.redirect('/teacher-dashboard'));
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
            db.all(`SELECT * FROM courses WHERE class_level = ? ORDER BY id`, [student.class_level], (err, courses) => {
                db.get(`SELECT * FROM sections WHERE name = ?`, [student.class_level], (err, section) => {

                    let monitor = section || { monitor_name: "N/A", monitor_phone: "-" };
                    let courseRows = courses.map(c => `<tr><td>${c.code}</td><td>${c.title}</td><td>${c.credit_hours}</td><td>${c.teacher_name}</td></tr>`).join('');
                    let wHistory = wRecs.map(w => `<p>📝 <b>Reason:</b> ${w.reason} | <b>Status:</b> <span style="color:${w.status==='Approved'?'green':(w.status==='Rejected'?'red':'orange')}">${w.status}</span> | <b>Admin Reply:</b> ${w.admin_reply||'Pending'}</p>`).join('');

                    res.send(`
                    <!DOCTYPE html><html lang="${lang}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Student Dashboard</title>
                    <style>body{font-family:sans-serif; background:#f4f7f6; padding:20px;} .container{max-width:800px; margin:auto;} .card{background:white; padding:20px; border-radius:10px; margin-bottom:20px; box-shadow:0 2px 5px rgba(0,0,0,0.1); overflow-x:auto;} table{width:100%; border-collapse:collapse; margin-top:10px; min-width:400px;} th,td{border:1px solid #ccc; padding:8px; text-align:center;} th{background:#1f4e79; color:white;}</style></head>
                    <body>
                        <div class="container">
                            <div style="text-align:right;"><a href="/student-dashboard?lang=am">አማርኛ</a> | <a href="/student-dashboard?lang=en">English</a></div>
                            <h2>🎓 Student Dashboard</h2>
                            <div class="card" style="background:#d4edda; color:#155724;">📢 <b>Admin Message:</b> ${student.admin_message}</div>

                            <div class="card" style="display:flex; gap:20px; align-items:center;">
                                <img src="/uploads/${student.photo}" style="width:100px; height:120px; object-fit:cover; border-radius:5px;">
                                <div>
                                    <h3>${student.name} (${student.student_id})</h3>
                                    <p><b>Class:</b> ${student.class_level} | <b>Monitor:</b> ${monitor.monitor_name} (${monitor.monitor_phone})</p>
                                    <a href="/download-id-pdf/${student.student_id}" style="display:inline-block; padding:10px; background:#27ae60; color:white; text-decoration:none; border-radius:5px; font-weight:bold;">📥 Download Digital ID w/ QR Code</a>
                                </div>
                            </div>

                            <div class="card">
                                <h3>📚 Registered Courses (Current Semester)</h3>
                                <table><tr><th>Code</th><th>Course Title</th><th>Cr.Hr</th><th>Instructor</th></tr>${courseRows||'<tr><td colspan="4">No courses assigned yet</td></tr>'}</table>
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
                                    <button type="submit" style="background:#e67e22; color:white; padding:10px; border:none; border-radius:5px; width:100%; cursor:pointer; font-weight:bold;">Submit Withdrawal Request</button>
                                </form>
                            </div>
                            <a href="/logout" style="color:red; font-weight:bold; font-size:18px;">🔒 Logout</a>
                        </div>
                    </body></html>`);
                });
            });
        });
    });
});

app.post('/student/withdraw', (req, res) => {
    if (!req.session.studentId) return res.redirect('/');
    db.run(`INSERT INTO withdrawals (student_id, reason, details, status) VALUES (?,?,?,?)`, [req.session.studentId, req.body.reason, req.body.details, 'Pending'], () => res.redirect('/student-dashboard'));
});

// DIGITAL ID PDF (WITH PHOTO & QR CODE)
app.get('/download-id-pdf/:id', (req, res) => {
    db.get(`SELECT * FROM students WHERE student_id = ?`, [req.params.id], (err, student) => {
        if (!student) return res.send('Student not found');

        const doc = new PDFDocument({ size: [400, 260], margin: 0 });
        res.setHeader('Content-Type', 'application/pdf'); 
        res.setHeader('Content-Disposition', `attachment; filename=ID-${student.student_id}.pdf`);
        doc.pipe(res);

        doc.rect(0, 0, 400, 260).fill('#fdfefe');
        doc.rect(4, 4, 392, 252).lineWidth(1.5).strokeColor('#1f4e79').stroke();

        doc.rect(4, 4, 392, 46).fill('#1f4e79');
        doc.circle(30, 27, 16).fill('#ffffff');
        doc.fontSize(12).fillColor('#1f4e79').text('MWU', 15, 20);
        doc.fontSize(13).fillColor('#ffffff').text('MADDA WALABU UNIVERSITY', 55, 12, { width: 300 });
        doc.fontSize(8.5).fillColor('#f4d03f').text('OFFICIAL DIGITAL STUDENT ID CARD', 55, 30, { width: 300 });

        let photoFile = path.join(__dirname, 'uploads', student.photo || '');
        doc.rect(18, 60, 84, 100).lineWidth(1).strokeColor('#1f4e79').stroke();
        if (student.photo && fs.existsSync(photoFile)) doc.image(photoFile, 20, 62, { width: 80, height: 96 });

        doc.fontSize(10).fillColor('#000');
        doc.font('Helvetica-Bold').text(`${student.name} ${student.father_name}`, 115, 62, { width: 260 });
        doc.font('Helvetica').fontSize(9);
        doc.text(`ID No: ${student.student_id}`, 115, 80);
        doc.text(`Dept: ${student.department}`, 115, 96);
        doc.text(`Class: ${student.class_level}`, 115, 112);
        doc.text(`Phone: ${student.phone}`, 115, 128);
        doc.fillColor('#27ae60').font('Helvetica-Bold').text(`Status: ${student.status || 'Approved'}`, 115, 146);

        doc.rect(4, 170, 392, 20).fill('#eef2f5');
        doc.fontSize(7.5).fillColor('#555').text('This card is property of Madda Walabu University. If found, please return to the Registrar office.', 12, 176, { width: 376, align: 'center' });

        // 1. Prepare the full information string for the QR payload
        let qrData = `Name: ${student.name} ${student.father_name}\nID: ${student.student_id}\nGender: ${student.gender}\nDept: ${student.department}\nClass: ${student.class_level}\nPhone: ${student.phone}`;

        // 2. Generate QR Code instead of a 1D barcode
        bwipjs.toBuffer({ 
            bcid: 'qrcode', 
            text: qrData, 
            scale: 3 
        }, function (err, png) {
            if (!err) {
                // 3. Render as a square centered at the bottom
                doc.image(png, 172.5, 195, { width: 55, height: 55 });
            }
            doc.end();
        });
    });
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
