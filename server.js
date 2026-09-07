const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const PDFDocument = require('pdfkit');
const bwipjs = require('bwip-js');
let XLSX;
try { XLSX = require('xlsx'); } catch (e) { XLSX = null; console.log('⚠️  xlsx package not found. Run: npm install xlsx  (Excel upload needs it)'); }
const app = express();
const PORT = process.env.PORT || 3000;

// Normalize name for matching (trim, lowercase, collapse spaces)
function normalizeName(s) {
    return (s || '').toString().trim().toLowerCase().replace(/\s+/g, ' ');
}

// ================== DATABASE CONNECTION ==================
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ MongoDB Connected'))
    .catch(err => console.log('❌ MongoDB Error:', err));

// ================== SCHEMAS ==================
const teacherSchema = new mongoose.Schema({
    teacher_id: { type: String, unique: true },
    name: String, dept: String, pass: String, phone: String, assigned_section: String
});
const Teacher = mongoose.model('Teacher', teacherSchema);

const studentSchema = new mongoose.Schema({
    student_id: { type: String, unique: true },
    password: String, name: String, father_name: String, mother_name: String,
    gender: String, age: String, phone: String, department: String,
    class_level: String, bank_slip_val: String, photo: String,
    status: String, admin_message: String, payment_status: String
});
const Student = mongoose.model('Student', studentSchema);

const pendingStudentSchema = new mongoose.Schema({
    student_id: String, password: String, name: String, father_name: String,
    mother_name: String, gender: String, age: String, phone: String,
    department: String, class_level: String, bank_slip_val: String, photo: String
});
const PendingStudent = mongoose.model('PendingStudent', pendingStudentSchema);

const assessmentSchema = new mongoose.Schema({
    section: String, teacherName: String, title: String, description: String, deadline: String
});
const Assessment = mongoose.model('Assessment', assessmentSchema);

const notificationSchema = new mongoose.Schema({
    type: String, message: String, time: String
});
const Notification = mongoose.model('Notification', notificationSchema);

const courseSchema = new mongoose.Schema({
    course_name: String, class_level: String, teacher_name: String,
    day: String, time: String, room: String
});
const Course = mongoose.model('Course', courseSchema);

const withdrawalSchema = new mongoose.Schema({
    student_id: String, student_name: String, reason: String,
    status: { type: String, default: 'Pending' }, admin_response: String,
    date: String
});
const Withdrawal = mongoose.model('Withdrawal', withdrawalSchema);

// ---- NEW SCHEMAS ADDED ----
const gradeSchema = new mongoose.Schema({
    student_id: String, course_name: String, assessment_type: String,
    score: Number, max_score: Number, teacherName: String, date: String
});
const Grade = mongoose.model('Grade', gradeSchema);

const announcementSchema = new mongoose.Schema({
    section: String, teacherName: String, message: String, date: String
});
const Announcement = mongoose.model('Announcement', announcementSchema);

const attendanceSchema = new mongoose.Schema({
    student_id: String, student_name: String, section: String,
    date: String, status: String // "Present", "Absent", "Late"
});
const Attendance = mongoose.model('Attendance', attendanceSchema);

// Password reset request (student/teacher forget password → admin handles)
const passwordResetSchema = new mongoose.Schema({
    role: String,           // "student" | "teacher"
    user_id: String,        // student_id or teacher_id
    name: String,
    phone: String,
    reason: String,
    status: { type: String, default: 'Pending' }, // Pending | Completed
    admin_note: String,
    new_password: String,
    date: String
});
const PasswordReset = mongoose.model('PasswordReset', passwordResetSchema);

// Pre-approved student list (admin uploads Excel / adds manually BEFORE self-registration)
const preApprovedSchema = new mongoose.Schema({
    full_name: { type: String, required: true },
    father_name: String,
    phone: String,
    department: String,
    year_level: String,          // e.g. "1st Year"
    gender: String,
    status: { type: String, default: 'Available' }, // Available | Used
    used_by_student_id: String,
    source: String,              // "excel" | "manual"
    uploaded_at: String
});
const PreApproved = mongoose.model('PreApproved', preApprovedSchema);
// ---- END NEW SCHEMAS ----

// ================== UPLOADS ==================
if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads');

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static('uploads'));

app.use(session({
    secret: 'mwu-admin-control-secret',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 3600000 }
}));

const ADMIN_USER = "amanuel";
const ADMIN_PASS = "kefisha123";
function generateStudentID() { return `MWU-${Math.floor(1000 + Math.random() * 9000)}`; }
function generate4DigitPIN() { return Math.floor(1000 + Math.random() * 9000).toString(); }

// Static section info (not stored in DB)
let sectionSchedules = {
    "1st Year - Section A": [
        { course: "Stat 101: Introduction to Statistics", teacher: "Dr. Teshale Kebede", time: "Mon 03:00 - 05:00 AM", room: "Hall-04" },
        { course: "Math 101: Calculus I", teacher: "Prof. Alemayehu", time: "Tue 08:00 - 10:00 AM", room: "Hall-02" }
    ],
    "1st Year - Section B": [
        { course: "Comp 101: Intro to Computer Science", teacher: "Abebech Bekele", time: "Mon 08:00 - 10:00 AM", room: "Lab-3" }
    ]
};

// Seed default teachers if none exist
async function seedTeachers() {
    const count = await Teacher.countDocuments();
    if (count === 0) {
        await Teacher.create([
            { teacher_id: "T-101", name: "Dr. Teshale Kebede", dept: "Statistics", pass: "123456", phone: "0911001122", assigned_section: "1st Year - Section A" },
            { teacher_id: "T-102", name: "Abebech Bekele", dept: "Computer Science", pass: "123456", phone: "0922334455", assigned_section: "1st Year - Section B" }
        ]);
        console.log('✅ Default teachers seeded');
    }
}
mongoose.connection.once('open', seedTeachers);

async function assignClassSection(requestedYearLevel) {
    const letters = ["A", "B", "C", "D", "E", "F", "G"];
    for (let i = 0; i < letters.length; i++) {
        let secName = `${requestedYearLevel} - Section ${letters[i]}`;
        let currentCount = await Student.countDocuments({ class_level: secName });
        let pendingCount = await PendingStudent.countDocuments({ class_level: secName });
        if ((currentCount + pendingCount) < 50) return secName;
    }
    return `${requestedYearLevel} - Section Overflow`;
}

// ================== ROUTES ==================
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="am">
    <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MWU Digital Portal</title>
    <style>
        * { box-sizing: border-box; font-family: sans-serif; }
        body { background-color: #f4f7f6; margin: 0; padding: 20px; font-size: 16px; }
        .container { max-width: 480px; margin: 0 auto; text-align: center; background: white; padding: 30px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); }
        h2 { font-size: 22px; color: #1f4e79; margin-bottom:20px; }
        select, input { width: 100%; padding: 12px; margin-bottom: 15px; border: 1px solid #ccc; border-radius: 8px; font-size: 15px; }
        .btn-login { width: 100%; padding: 12px; background: #1f4e79; color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: bold; cursor: pointer; }
        .btn-register { display: block; margin-top: 15px; background: #27ae60; color: white; text-decoration: none; padding: 10px; border-radius: 8px; font-weight: bold; font-size: 15px; }
        .btn-forgot { display: block; margin-top: 12px; background: #e67e22; color: white; text-decoration: none; padding: 10px; border-radius: 8px; font-weight: bold; font-size: 14px; }
    </style></head>
    <body>
        <div class="container">
            <h2>🎓 MWU DIGITAL PORTAL</h2>
            <form action="/login" method="POST">
                <select name="role">
                    <option value="student">🎓 ተማሪ (Student Login)</option>
                    <option value="teacher">👨‍🏫 መምህር (Teacher Login)</option>
                    <option value="admin">🔐 አድሚን (Admin Login)</option>
                </select>
                <input type="text" name="username" placeholder="ID Number / Username" required>
                <input type="text" name="password" placeholder="Password / PIN" required>
                <button type="submit" class="btn-login">Log In</button>
            </form>
            <a href="/forgot-password" class="btn-forgot">🔑 ፓስዎርድ ረሳሁ (Forgot Password)</a>
            <a href="/student-register" class="btn-register">📝 አዲስ ተማሪ ምዝገባ (Self Register)</a>
        </div>
    </body></html>
    `);
});

app.get('/student-register', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="am">
    <head><meta charset="UTF-8"><title>Student Registration</title>
    <style>body { font-family: sans-serif; background: #eef2f5; padding: 15px; font-size: 15px; } .container { max-width: 600px; margin: 0 auto; background: white; padding: 25px; border-radius: 12px; } input, select { width: 100%; padding: 10px; margin-top: 4px; margin-bottom: 12px; border: 1px solid #ccc; border-radius: 6px; box-sizing: border-box; }</style></head>
    <body><div class="container">
        <h2>📝 ሙሉ የተማሪዎች ምዝገባ ፎርም</h2>
        <p style="background:#fff3cd; border:1px solid #f0c36d; padding:10px; border-radius:8px; font-size:13px; color:#856404;">
            ⚠️ <b>ማሳሰቢያ:</b> ስምዎ በአድሚን ቅድመ-ዝርዝር (Pre-Approved List) ውስጥ ካልሆነ ምዝገባ አይፈቀድም። ስምዎን <b>እንደ ዝርዝሩ</b> በትክክል ያስገቡ።
        </p>
        <form id="regForm" action="/api/student-self-register" method="POST" enctype="multipart/form-data">
            <label>ሙሉ ስም (Full Name):</label><input type="text" name="name" required>
            <label>የአባት ስም:</label><input type="text" name="father_name" required>
            <label>የእናት ስም:</label><input type="text" name="mother_name" required>
            <label>ጾታ:</label><select name="gender"><option value="Male">Male</option><option value="Female">Female</option></select>
            <label>ዕድሜ:</label><input type="number" name="age" required>
            <label>ስልክ ቁጥር:</label><input type="text" name="phone" required>
            <label>ትምህርት ክፍል (Department):</label><input type="text" name="department" required>
            <label>Academic Year Level:</label>
            <select name="year_level"><option value="1st Year">1st Year</option><option value="2nd Year">2nd Year</option><option value="3rd Year">3rd Year</option></select>
            <label>ፎቶ:</label><input type="file" name="student_photo" accept="image/*" required>
            <label>የትራንዛክሽን ቁጥር (Txn ID):</label><input type="text" name="txn_id" required>
            <button type="submit" id="submitBtn" style="background:#27ae60; color:white; border:none; padding:12px; width:100%; border-radius:8px; font-weight:bold; cursor:pointer;">🚀 ምዝገባውን ለአድሚን ላክ</button>
        </form>
    </div>
    <script>
        document.getElementById('regForm').addEventListener('submit', function(e) {
            const btn = document.getElementById('submitBtn');
            if (btn.disabled) {
                e.preventDefault();
                return false;
            }
            btn.disabled = true;
            btn.style.background = '#95a5a6';
            btn.style.cursor = 'not-allowed';
            btn.innerHTML = '⏳ እየተላከ ነው... እባክዎ ይጠብቁ';
        });
    </script>
    </body></html>
    `);
});

const registerUpload = upload.fields([{ name: 'student_photo', maxCount: 1 }]);

app.post('/api/student-self-register', registerUpload, async (req, res) => {
    const { name, father_name, mother_name, gender, age, phone, department, year_level, txn_id } = req.body;

    const nameNorm = normalizeName(name);
    const fatherNorm = normalizeName(father_name);

    // ---- MUST be on admin pre-approved list ----
    const candidates = await PreApproved.find({ status: 'Available' });
    let matched = null;
    for (const row of candidates) {
        if (normalizeName(row.full_name) === nameNorm) {
            // If father_name exists on list, require match; otherwise name alone is enough
            if (row.father_name && normalizeName(row.father_name)) {
                if (fatherNorm === normalizeName(row.father_name)) {
                    matched = row;
                    break;
                }
            } else {
                matched = row;
                break;
            }
        }
    }

    if (!matched) {
        return res.send(`
        <div style="font-family:sans-serif; text-align:center; padding:30px; max-width:520px; margin:auto;">
            <h2 style="color:#c0392b;">❌ ስምዎ በቅድመ-ዝርዝር (Pre-Approved List) ላይ አልተገኘም!</h2>
            <p>ምዝገባ ለመጀመር ስምዎ በአድሚን ባስገባው Excel / ዝርዝር ውስጥ መኖር አለበት።</p>
            <p style="color:#666; font-size:14px;">እባክዎ ስምዎን በትክክል (እንደ ዝርዝሩ) ያስገቡ ወይም አድሚንን ያነጋግሩ።</p>
            <br><a href="/student-register">⬅ ተመለስ</a> &nbsp;|&nbsp; <a href="/">ወደ መግቢያ</a>
        </div>`);
    }

    // Duplicate check: same name + phone + txn_id submitted within the last 60 seconds
    const oneMinuteAgo = new Date(Date.now() - 60000);
    const existingPending = await PendingStudent.findOne({
        name: name.trim(),
        phone: phone.trim(),
        bank_slip_val: txn_id
    }).sort({ _id: -1 });

    if (existingPending && existingPending._id.getTimestamp() > oneMinuteAgo) {
        return res.send(`<div style="font-family:sans-serif; text-align:center; padding:30px;"><h2 style="color:orange;">⚠️ ይህ ምዝገባ አስቀድሞ ተልኳል!</h2><p>የተመደቡበት ID: <b>${existingPending.student_id}</b> እና PIN: <b>${existingPending.password}</b></p><br><a href="/">ወደ መግቢያ ተመለስ</a></div>`);
    }

    // Also block if already fully registered with same name
    const alreadyStudent = await Student.findOne({ name: name.trim() });
    if (alreadyStudent) {
        return res.send(`<div style="font-family:sans-serif; text-align:center; padding:30px;"><h2 style="color:orange;">⚠️ ይህ ስም አስቀድሞ ተመዝግቧል!</h2><p>ID: <b>${alreadyStudent.student_id}</b></p><br><a href="/">ወደ መግቢያ</a></div>`);
    }

    let autoID = generateStudentID();
    let autoPIN = generate4DigitPIN();
    let assignedSection = await assignClassSection(year_level);
    let photoPath = req.files && req.files['student_photo'] ? req.files['student_photo'][0].filename : '';

    await PendingStudent.create({
        student_id: autoID, password: autoPIN, name: name.trim(), father_name, mother_name,
        gender, age, phone, department: department.trim(), class_level: assignedSection,
        bank_slip_val: txn_id, photo: photoPath
    });

    // Mark pre-approved row as Used
    await PreApproved.findByIdAndUpdate(matched._id, {
        status: 'Used',
        used_by_student_id: autoID
    });

    await Notification.create({
        type: 'STUDENT_REGISTRATION',
        message: `አዲስ ተማሪ ተመዝግቧል: ${name.trim()} (${assignedSection}) — ከቅድመ-ዝርዝር`,
        time: new Date().toLocaleString()
    });

    res.send(`<div style="font-family:sans-serif; text-align:center; padding:30px;"><h2 style="color:green;">✅ ምዝገባዎ ተልኳል!</h2><p>የተመደቡበት ID: <b>${autoID}</b> እና PIN: <b>${autoPIN}</b></p><p style="color:#27ae60; font-size:13px;">✓ ስምዎ ከቅድመ-ዝርዝር ጋር ተገኝቷል</p><br><a href="/">ወደ መግቢያ ተመለስ</a></div>`);
});

app.post('/login', async (req, res) => {
    const { role, username, password } = req.body;
    const uKey = username.trim();

    if (role === 'admin' && uKey === ADMIN_USER && password === ADMIN_PASS) {
        req.session.isAdminLoggedIn = true;
        return res.redirect('/admin');
    } else if (role === 'teacher') {
        const teacher = await Teacher.findOne({ teacher_id: uKey, pass: password.trim() });
        if (teacher) {
            req.session.teacherId = uKey;
            return res.redirect('/teacher-dashboard');
        }
    } else if (role === 'student') {
        const uppercaseKey = uKey.toUpperCase();
        const student = await Student.findOne({ student_id: uppercaseKey, password: password.trim() });
        if (student) {
            req.session.studentId = uppercaseKey;
            return res.redirect('/student-dashboard');
        }
    }
    res.send('<h3 style="color:red; text-align:center; margin-top:50px;">❌ የተሳሳተ መረጃ! <a href="/">ተመለስ</a></h3>');
});

// ================== FORGOT PASSWORD (request → admin only) ==================
app.get('/forgot-password', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="am">
    <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Forgot Password</title>
    <style>
        body { font-family: sans-serif; background: #eef2f5; padding: 20px; }
        .container { max-width: 480px; margin: 0 auto; background: white; padding: 25px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
        input, select, textarea { width: 100%; padding: 10px; margin: 6px 0 14px; border: 1px solid #ccc; border-radius: 6px; box-sizing: border-box; }
        button { width: 100%; padding: 12px; background: #e67e22; color: white; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; }
    </style></head>
    <body>
        <div class="container">
            <h2 style="color:#e67e22; text-align:center;">🔑 ፓስዎርድ ረሳሁ</h2>
            <p style="text-align:center; color:#555; font-size:14px;">IDዎን እና ስልክዎን ያስገቡ። ጥያቄዎ ወደ አድሚን ይላካል። አድሚን ብቻ ነው ፓስዎርድ የሚቀይር እና የሚሰጥዎት።</p>
            <form action="/api/forgot-password" method="POST">
                <label>Role:</label>
                <select name="role" required>
                    <option value="student">🎓 ተማሪ (Student)</option>
                    <option value="teacher">👨‍🏫 መምህር (Teacher)</option>
                </select>
                <label>ID Number:</label>
                <input type="text" name="user_id" placeholder="MWU-1234 ወይም T-101" required>
                <label>ስልክ ቁጥር (Phone):</label>
                <input type="text" name="phone" placeholder="09xxxxxxxx" required>
                <label>ምክንያት (Reason):</label>
                <textarea name="reason" rows="3" placeholder="ፓስዎርድ ረሳሁ..." required></textarea>
                <button type="submit">📤 ጥያቄ ላክ (Send Request)</button>
            </form>
            <p style="text-align:center; margin-top:18px;"><a href="/">⬅ ወደ መግቢያ ተመለስ</a></p>
        </div>
    </body></html>
    `);
});

app.post('/api/forgot-password', async (req, res) => {
    const { role, user_id, phone, reason } = req.body;
    const id = (user_id || '').trim();
    const phoneTrim = (phone || '').trim();

    let name = '';
    let found = false;

    if (role === 'student') {
        const st = await Student.findOne({ student_id: id.toUpperCase() });
        if (st) {
            found = true;
            name = st.name;
            // optional phone match check (soft)
        }
    } else if (role === 'teacher') {
        const t = await Teacher.findOne({ teacher_id: id });
        if (t) {
            found = true;
            name = t.name;
        }
    }

    if (!found) {
        return res.send(`<div style="font-family:sans-serif; text-align:center; padding:40px;"><h2 style="color:red;">❌ ይህ ID አልተገኘም!</h2><p>እባክዎ ትክክለኛ ID ያስገቡ።</p><br><a href="/forgot-password">ተመለስ</a></div>`);
    }

    // Prevent spam: same user pending request in last 5 minutes
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    const existing = await PasswordReset.findOne({
        user_id: role === 'student' ? id.toUpperCase() : id,
        status: 'Pending'
    }).sort({ _id: -1 });

    if (existing && existing._id.getTimestamp() > fiveMinAgo) {
        return res.send(`<div style="font-family:sans-serif; text-align:center; padding:40px;"><h2 style="color:orange;">⚠️ ጥያቄዎ አስቀድሞ ተልኳል!</h2><p>አድሚን ምላሽ እስኪሰጥ ይጠብቁ።</p><br><a href="/">ወደ መግቢያ</a></div>`);
    }

    await PasswordReset.create({
        role,
        user_id: role === 'student' ? id.toUpperCase() : id,
        name,
        phone: phoneTrim,
        reason: (reason || '').trim(),
        status: 'Pending',
        date: new Date().toLocaleString()
    });

    await Notification.create({
        type: 'PASSWORD_RESET_REQUEST',
        message: `🔑 ${role === 'student' ? 'ተማሪ' : 'መምህር'} ${name} (${role === 'student' ? id.toUpperCase() : id}) ፓስዎርድ ረሳ ጠይቋል`,
        time: new Date().toLocaleString()
    });

    res.send(`<div style="font-family:sans-serif; text-align:center; padding:40px;"><h2 style="color:green;">✅ ጥያቄዎ ተልኳል!</h2><p>አድሚን ምላሽ ሰጥቶ አዲስ ፓስዎርድ ይሰጥዎታል። እባክዎ ይጠብቁ።</p><br><a href="/">ወደ መግቢያ ተመለስ</a></div>`);
});

app.get('/admin', async (req, res) => {
    if (!req.session.isAdminLoggedIn) return res.redirect('/');

    const pendingStudents = await PendingStudent.find();
    const teachers = await Teacher.find();
    const students = await Student.find();
    const notifications = await Notification.find().sort({ _id: -1 }).limit(20);
    const withdrawals = await Withdrawal.find({ status: 'Pending' });
    const passwordResets = await PasswordReset.find({ status: 'Pending' }).sort({ _id: -1 });
    const preAvailable = await PreApproved.countDocuments({ status: 'Available' });
    const preUsed = await PreApproved.countDocuments({ status: 'Used' });
    const preTotal = preAvailable + preUsed;

    let pendingRows = pendingStudents.map(st => `
        <tr>
            <td>${st.student_id}</td>
            <td><b>${st.password}</b></td>
            <td>${st.name}</td>
            <td>${st.father_name || '-'}</td>
            <td>${st.mother_name || '-'}</td>
            <td>${st.gender || '-'}</td>
            <td>${st.age || '-'}</td>
            <td>${st.phone || '-'}</td>
            <td>${st.department || '-'}</td>
            <td>${st.class_level}</td>
            <td>${st.bank_slip_val}</td>
            <td><a href="/admin/approve-student/${st._id}" style="background:green; color:white; padding:4px 8px; text-decoration:none; border-radius:4px;">✅ Approve</a></td>
        </tr>
    `).join('') || '<tr><td colspan="12">ምንም አዲስ ጥያቄ የለም</td></tr>';

    let teacherRows = teachers.map(t => `
        <tr>
            <td>${t.teacher_id}</td>
            <td><b style="color:#c0392b;">${t.pass}</b></td>
            <td>${t.name}</td>
            <td>${t.dept || '-'}</td>
            <td>${t.phone || '-'}</td>
            <td>${t.assigned_section}</td>
            <td>
                <a href="/admin/edit-teacher/${t.teacher_id}" style="background:#2980b9; color:white; padding:3px 6px; text-decoration:none; border-radius:4px;">✏️ Edit / Reset Pass</a>
            </td>
        </tr>
    `).join('') || '<tr><td colspan="7">መምህር የለም</td></tr>';

    let studentRows = students.map(st => `
        <tr>
            <td>${st.student_id}</td>
            <td><b style="color:#c0392b;">${st.password}</b></td>
            <td>${st.name}</td>
            <td>${st.father_name || '-'}</td>
            <td>${st.mother_name || '-'}</td>
            <td>${st.gender || '-'}</td>
            <td>${st.age || '-'}</td>
            <td>${st.phone || '-'}</td>
            <td>${st.department || '-'}</td>
            <td>${st.class_level}</td>
            <td>${st.bank_slip_val || '-'}</td>
            <td>${st.payment_status === 'Verified' ? '✅ Verified' : `<a href="/admin/verify-payment/${st.student_id}" style="background:#f39c12; color:white; padding:3px 6px; text-decoration:none; border-radius:4px;">💰 Verify</a>`}</td>
            <td>
                <a href="/admin/edit-student/${st.student_id}" style="background:#2980b9; color:white; padding:3px 6px; text-decoration:none; border-radius:4px;">✏️ Edit / Reset Pass</a>
                <a href="/admin/id-card/${st.student_id}" style="background:#8e44ad; color:white; padding:3px 6px; text-decoration:none; border-radius:4px; margin-left:3px;" target="_blank">🪪 ID</a>
            </td>
        </tr>
    `).join('') || '<tr><td colspan="13">የጸደቁ ተማሪዎች የሉም</td></tr>';

    let notifRows = notifications.map(n => `
        <li style="padding:5px 0; border-bottom:1px dashed #ccc;">🔔 <b>${n.message}</b> <small style="color:#666;">(${n.time})</small></li>
    `).join('') || '<li>ምንም ማሳወቂያ የለም</li>';

    let withdrawalRows = withdrawals.map(w => `
        <tr><td>${w.student_id}</td><td>${w.student_name}</td><td>${w.reason}</td><td>${w.date}</td>
        <td><a href="/admin/respond-withdrawal/${w._id}" style="background:#c0392b; color:white; padding:4px 8px; text-decoration:none; border-radius:4px;">📩 ምላሽ</a></td></tr>
    `).join('') || '<tr><td colspan="5">ምንም withdrawal ጥያቄ የለም</td></tr>';

    let resetRows = passwordResets.map(r => `
        <tr>
            <td>${r.role === 'student' ? '🎓 ተማሪ' : '👨‍🏫 መምህር'}</td>
            <td><b>${r.user_id}</b></td>
            <td>${r.name}</td>
            <td>${r.phone || '-'}</td>
            <td>${r.reason}</td>
            <td>${r.date}</td>
            <td><a href="/admin/handle-password-reset/${r._id}" style="background:#e67e22; color:white; padding:4px 8px; text-decoration:none; border-radius:4px;">🔑 Reset & Give</a></td>
        </tr>
    `).join('') || '<tr><td colspan="7">ምንም ፓስዎርድ ረሳ ጥያቄ የለም</td></tr>';

    res.send(`
    <!DOCTYPE html>
    <html lang="am">
    <head><meta charset="UTF-8"><title>Admin Dashboard</title>
    <style>
        body { font-family: sans-serif; background: #eef2f5; padding: 15px; font-size: 12px; }
        .card { background: white; padding: 15px; border-radius: 10px; margin-bottom: 20px; overflow-x: auto; }
        table { width: 100%; border-collapse: collapse; margin-top:5px; min-width: 900px; }
        th, td { border: 1px solid #ddd; padding: 5px 6px; text-align: center; vertical-align: middle; }
        th { background: #34495e; color: white; position: sticky; top: 0; }
        h2 { margin-top: 0; }
    </style></head>
    <body>
        <h2>🔐 ADMIN CONTROL & NOTIFICATIONS DASHBOARD</h2>

        <!-- TOP NAV LINKS - always visible -->
        <div style="background:#1f4e79; padding:12px; border-radius:10px; margin-bottom:16px; text-align:center; display:flex; flex-wrap:wrap; gap:8px; justify-content:center;">
            <a href="/admin/pre-approved" style="background:#27ae60; color:white; padding:10px 16px; text-decoration:none; border-radius:8px; font-weight:bold; font-size:14px;">📋 ቅድመ-ዝርዝር</a>
            <a href="/admin/export-students-by-section" style="background:#16a085; color:white; padding:10px 16px; text-decoration:none; border-radius:8px; font-weight:bold; font-size:14px;">⬇ ተማሪዎች Excel</a>
            <a href="/admin/add-teacher" style="background:#2980b9; color:white; padding:10px 16px; text-decoration:none; border-radius:8px; font-weight:bold; font-size:14px;">➕ መምህር</a>
            <a href="/admin/add-course" style="background:#8e44ad; color:white; padding:10px 16px; text-decoration:none; border-radius:8px; font-weight:bold; font-size:14px;">➕ ኮርስ</a>
            <a href="/logout" style="background:#c0392b; color:white; padding:10px 16px; text-decoration:none; border-radius:8px; font-weight:bold; font-size:14px;">🔒 Logout</a>
        </div>

        <!-- PRE-APPROVED - FIRST CARD so admin sees it immediately -->
        <div class="card" style="background:#eafaf1; border:2px solid #27ae60;">
            <h3 style="color:#27ae60; margin-top:0;">📋 ቅድመ-ዝርዝር (Pre-Approved List)</h3>
            <p style="margin:6px 0; font-size:14px;">
                ጠቅላላ: <b>${preTotal}</b> &nbsp;|&nbsp;
                Available: <b style="color:green;">${preAvailable}</b> &nbsp;|&nbsp;
                Used: <b style="color:#888;">${preUsed}</b>
            </p>
            <p style="font-size:12px; color:#555;">ተማሪ ምዝገባ ከማድረጉ በፊት ስሙ እዚህ መኖር አለበት። CSV ስቀም ወይም በእጅ ጨምር።</p>
            <a href="/admin/pre-approved" style="background:#27ae60; color:white; padding:12px 22px; text-decoration:none; border-radius:8px; font-weight:bold; display:inline-block; font-size:15px;">📂 ዝርዝር ክፈት / ስም ጨምር / CSV ስቀም →</a>
        </div>

        <div class="card" style="background:#fdf2f2; border:1px solid #c0392b;">
            <h3 style="color:#c0392b; margin-top:0;">🔔 የአድሚን ማሳወቂያዎች (Notifications)</h3>
            <ul style="margin:0; padding-left:20px; max-height:120px; overflow-y:auto;">${notifRows}</ul>
        </div>

        <div class="card" style="background:#fff8e7; border:1px solid #e67e22;">
            <h3 style="color:#e67e22; margin-top:0;">🔑 ፓስዎርድ ረሳ ጥያቄዎች (Forgot Password Requests)</h3>
            <table>
                <thead><tr><th>Role</th><th>ID</th><th>Name</th><th>Phone</th><th>Reason</th><th>Date</th><th>Action</th></tr></thead>
                <tbody>${resetRows}</tbody>
            </table>
        </div>

        <div class="card"><h3>📥 አዲስ የተመዘገቡ ተማሪዎች (Pending Registration) — Full Info</h3>
        <table>
            <thead><tr>
                <th>ID</th><th>Password</th><th>Name</th><th>Father</th><th>Mother</th><th>Gender</th><th>Age</th><th>Phone</th><th>Dept</th><th>Class</th><th>Txn ID</th><th>Action</th>
            </tr></thead>
            <tbody>${pendingRows}</tbody>
        </table></div>

        <div class="card"><h3>👨‍🏫 የመምህራን ዝርዝር (Full Info + Password)</h3>
        <table>
            <thead><tr><th>ID</th><th>Password</th><th>Name</th><th>Dept</th><th>Phone</th><th>Section</th><th>Action</th></tr></thead>
            <tbody>${teacherRows}</tbody>
        </table></div>

        <div class="card"><h3>🎓 የጸደቁ ተማሪዎች ዝርዝር (Full Info + Password)</h3>
        <div style="margin-bottom:10px;">
            <a href="/admin/export-students" style="background:#16a085; color:white; padding:8px 14px; text-decoration:none; border-radius:6px; font-weight:bold; display:inline-block; margin-right:6px;">⬇ ሁሉንም ተማሪዎች CSV አውርድ</a>
            <a href="/admin/export-students-by-section" style="background:#1abc9c; color:white; padding:8px 14px; text-decoration:none; border-radius:6px; font-weight:bold; display:inline-block;">⬇ በ Class/Section ተከፍሎ አውርድ</a>
        </div>
        <table>
            <thead><tr>
                <th>ID</th><th>Password</th><th>Name</th><th>Father</th><th>Mother</th><th>Gender</th><th>Age</th><th>Phone</th><th>Dept</th><th>Class</th><th>Txn ID</th><th>Payment</th><th>Action</th>
            </tr></thead>
            <tbody>${studentRows}</tbody>
        </table></div>

        <div class="card" style="background:#fdf2f2;"><h3 style="color:#c0392b;">📝 Withdrawal ጥያቄዎች (Pending)</h3>
        <table><thead><tr><th>ID</th><th>Name</th><th>Reason</th><th>Date</th><th>Action</th></tr></thead><tbody>${withdrawalRows}</tbody></table></div>

        <div style="text-align:center; margin-bottom:20px;">
            <a href="/admin/pre-approved" style="background:#27ae60; color:white; padding:12px 20px; text-decoration:none; border-radius:8px; font-weight:bold; display:inline-block; margin-right:8px;">📋 ቅድመ-ዝርዝር</a>
            <a href="/admin/export-students-by-section" style="background:#16a085; color:white; padding:12px 20px; text-decoration:none; border-radius:8px; font-weight:bold; display:inline-block; margin-right:8px;">⬇ ተማሪዎች Excel/CSV</a>
            <a href="/admin/add-course" style="background:#8e44ad; color:white; padding:12px 20px; text-decoration:none; border-radius:8px; font-weight:bold; display:inline-block; margin-right:8px;">➕ አዲስ ኮርስ</a>
            <a href="/admin/add-teacher" style="background:#2980b9; color:white; padding:12px 20px; text-decoration:none; border-radius:8px; font-weight:bold; display:inline-block;">➕ አዲስ መምህር</a>
        </div>
        <a href="/logout" style="color:red; font-weight:bold; font-size:15px;">🔒 Logout</a>
    </body></html>
    `);
});

// ================== EXPORT STUDENTS TO EXCEL (no xlsx package needed) ==================
function escapeXml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function studentToRow(st) {
    return [
        st.student_id || '',
        st.password || '',
        st.name || '',
        st.father_name || '',
        st.mother_name || '',
        st.gender || '',
        st.age || '',
        st.phone || '',
        st.department || '',
        st.class_level || '',
        st.bank_slip_val || '',
        st.payment_status || '',
        st.status || ''
    ];
}

const STUDENT_HEADERS = ['ID', 'Password', 'Name', 'Father', 'Mother', 'Gender', 'Age', 'Phone', 'Department', 'Class/Section', 'Txn ID', 'Payment', 'Status'];

// Build real Excel XML (.xls) — opens in Excel / Google Sheets / LibreOffice without any npm package
function buildExcelXml(sheets) {
    // sheets: [{ name: 'Section A', rows: [ [..], [..] ] }]  rows include header as first row
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<?mso-application progid="Excel.Sheet"?>\n';
    xml += '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"\n';
    xml += ' xmlns:o="urn:schemas-microsoft-com:office:office"\n';
    xml += ' xmlns:x="urn:schemas-microsoft-com:office:excel"\n';
    xml += ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"\n';
    xml += ' xmlns:html="http://www.w3.org/TR/REC-html40">\n';
    xml += '<Styles>\n';
    xml += '<Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#1F4E79" ss:Pattern="Solid"/><Font ss:Color="#FFFFFF"/></Style>\n';
    xml += '</Styles>\n';

    for (const sheet of sheets) {
        let name = (sheet.name || 'Sheet').substring(0, 31).replace(/[\\/?*\[\]]/g, '-');
        if (!name) name = 'Sheet';
        xml += `<Worksheet ss:Name="${escapeXml(name)}">\n<Table>\n`;
        for (let i = 0; i < sheet.rows.length; i++) {
            xml += '<Row>\n';
            for (const cell of sheet.rows[i]) {
                const style = i === 0 ? ' ss:StyleID="Header"' : '';
                xml += `<Cell${style}><Data ss:Type="String">${escapeXml(cell)}</Data></Cell>\n`;
            }
            xml += '</Row>\n';
        }
        xml += '</Table>\n</Worksheet>\n';
    }
    xml += '</Workbook>';
    return xml;
}

// Admin page: choose section and download Excel
app.get('/admin/export-students-by-section', async (req, res) => {
    if (!req.session.isAdminLoggedIn) return res.redirect('/');
    const students = await Student.find().sort({ class_level: 1, name: 1 });

    const groups = {};
    for (const st of students) {
        const key = st.class_level || 'Unknown Section';
        if (!groups[key]) groups[key] = [];
        groups[key].push(st);
    }
    const sectionNames = Object.keys(groups).sort();

    const sectionCards = sectionNames.map(sec => `
        <div style="background:#f8f9fa; border:1px solid #ddd; border-radius:8px; padding:12px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
            <div>
                <b style="font-size:15px;">${sec}</b>
                <span style="color:#666; margin-left:8px;">${groups[sec].length} ተማሪዎች</span>
            </div>
            <a href="/admin/export-download?section=${encodeURIComponent(sec)}"
               style="background:#16a085; color:white; padding:8px 16px; text-decoration:none; border-radius:6px; font-weight:bold;">
               ⬇ Excel አውርድ
            </a>
        </div>
    `).join('') || '<p style="color:#888;">የጸደቁ ተማሪዎች የሉም።</p>';

    res.send(`
    <!DOCTYPE html>
    <html lang="am">
    <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Export Students Excel</title>
    <style>
        body { font-family: sans-serif; background:#eef2f5; padding:16px; }
        .card { background:white; padding:18px; border-radius:10px; max-width:700px; margin:0 auto 16px; }
        .btn { display:inline-block; padding:12px 20px; border-radius:8px; color:white; text-decoration:none; font-weight:bold; }
    </style></head>
    <body>
        <div class="card">
            <h2 style="margin-top:0; color:#16a085;">⬇ ተማሪዎች Excel ማውረጃ</h2>
            <p style="color:#555; font-size:14px;">በ Class / Section ለይተው Excel (.xls) ያውርዱ። Excel፣ Google Sheets፣ LibreOffice ሁሉም ይከፍታሉ። <b>xlsx package አያስፈልግም።</b></p>

            <div style="text-align:center; margin:16px 0;">
                <a href="/admin/export-download?section=ALL" class="btn" style="background:#1f4e79;">
                    ⬇ ሁሉንም Sections አንድ Excel (ሁሉም ሉሆች)
                </a>
            </div>
            <hr>
            <h3>በ Section ለይተው ያውርዱ</h3>
            ${sectionCards}
            <br>
            <a href="/admin">⬅ ወደ Admin ተመለስ</a>
        </div>
    </body></html>
    `);
});

// Actual file download
app.get('/admin/export-download', async (req, res) => {
    if (!req.session.isAdminLoggedIn) return res.redirect('/');

    const sectionFilter = req.query.section || 'ALL';
    let students = await Student.find().sort({ class_level: 1, name: 1 });

    if (sectionFilter !== 'ALL') {
        students = students.filter(st => (st.class_level || 'Unknown Section') === sectionFilter);
    }

    // Group by section
    const groups = {};
    for (const st of students) {
        const key = st.class_level || 'Unknown Section';
        if (!groups[key]) groups[key] = [];
        groups[key].push(st);
    }
    const sectionNames = Object.keys(groups).sort();

    // Prefer xlsx package if installed
    if (XLSX) {
        const wb = XLSX.utils.book_new();
        if (sectionNames.length === 0) {
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['No students']]), 'Empty');
        } else {
            for (const sec of sectionNames) {
                const rows = groups[sec].map(st => ({
                    ID: st.student_id,
                    Password: st.password,
                    Name: st.name,
                    Father: st.father_name || '',
                    Mother: st.mother_name || '',
                    Gender: st.gender || '',
                    Age: st.age || '',
                    Phone: st.phone || '',
                    Department: st.department || '',
                    'Class/Section': st.class_level || '',
                    'Txn ID': st.bank_slip_val || '',
                    Payment: st.payment_status || '',
                    Status: st.status || ''
                }));
                const ws = XLSX.utils.json_to_sheet(rows);
                let sheetName = sec.substring(0, 31).replace(/[\\/?*\[\]]/g, '-');
                if (!sheetName) sheetName = 'Section';
                XLSX.utils.book_append_sheet(wb, ws, sheetName);
            }
        }
        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        const fname = sectionFilter === 'ALL' ? 'all_students_by_section.xlsx' : `students_${sectionFilter.replace(/[^a-zA-Z0-9]/g, '_')}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
        return res.send(buf);
    }

    // Pure Excel XML (.xls) — works without any package
    const sheets = [];
    if (sectionNames.length === 0) {
        sheets.push({ name: 'Empty', rows: [['No registered students']] });
    } else {
        for (const sec of sectionNames) {
            const rows = [STUDENT_HEADERS];
            for (const st of groups[sec]) {
                rows.push(studentToRow(st));
            }
            sheets.push({ name: sec, rows });
        }
    }

    const xml = buildExcelXml(sheets);
    const fname = sectionFilter === 'ALL' ? 'all_students_by_section.xls' : `students_${sectionFilter.replace(/[^a-zA-Z0-9]/g, '_')}.xls`;
    res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.send(xml);
});

// ================== ADMIN: Handle Password Reset Request ==================
app.get('/admin/handle-password-reset/:id', async (req, res) => {
    if (!req.session.isAdminLoggedIn) return res.redirect('/');
    const r = await PasswordReset.findById(req.params.id);
    if (!r || r.status !== 'Pending') return res.redirect('/admin');

    // Suggest a new random PIN
    const suggested = generate4DigitPIN();

    res.send(`
    <div style="font-family:sans-serif; padding:25px; max-width:480px; margin:auto; background:#fff; border-radius:10px;">
        <h2 style="color:#e67e22;">🔑 ፓስዎርድ Reset ለ ${r.name}</h2>
        <p><b>Role:</b> ${r.role === 'student' ? 'ተማሪ' : 'መምህር'}</p>
        <p><b>ID:</b> ${r.user_id}</p>
        <p><b>Phone:</b> ${r.phone || '-'}</p>
        <p><b>Reason:</b> ${r.reason}</p>
        <hr>
        <form action="/admin/submit-password-reset/${r._id}" method="POST">
            <label>አዲስ Password / PIN:</label><br>
            <input type="text" name="new_password" value="${suggested}" required style="width:100%; padding:10px; margin:8px 0 14px; border:1px solid #ccc; border-radius:6px;">
            <label>Admin Note (optional):</label><br>
            <textarea name="admin_note" rows="2" placeholder="ለምሳሌ: አዲስ PIN ተሰጥቷል..." style="width:100%; padding:8px; margin-bottom:12px; border:1px solid #ccc; border-radius:6px;"></textarea>
            <button type="submit" style="background:#27ae60; color:white; border:none; padding:12px; width:100%; border-radius:6px; font-weight:bold;">✅ Reset & Save</button>
        </form>
        <br><a href="/admin">⬅ ወደ Admin ተመለስ</a>
    </div>`);
});

app.post('/admin/submit-password-reset/:id', async (req, res) => {
    if (!req.session.isAdminLoggedIn) return res.redirect('/');
    const r = await PasswordReset.findById(req.params.id);
    if (!r || r.status !== 'Pending') return res.redirect('/admin');

    const newPass = (req.body.new_password || '').trim();
    if (!newPass) {
        return res.send('<h3 style="color:red; text-align:center; margin-top:40px;">Password ባዶ መሆን አይችልም! <a href="/admin">ተመለስ</a></h3>');
    }

    if (r.role === 'student') {
        await Student.findOneAndUpdate({ student_id: r.user_id }, { password: newPass });
    } else if (r.role === 'teacher') {
        await Teacher.findOneAndUpdate({ teacher_id: r.user_id }, { pass: newPass });
    }

    await PasswordReset.findByIdAndUpdate(r._id, {
        status: 'Completed',
        new_password: newPass,
        admin_note: (req.body.admin_note || '').trim()
    });

    await Notification.create({
        type: 'PASSWORD_RESET_DONE',
        message: `✅ ${r.role === 'student' ? 'ተማሪ' : 'መምህር'} ${r.name} (${r.user_id}) ፓስዎርድ ተቀይሯል → ${newPass}`,
        time: new Date().toLocaleString()
    });

    res.send(`
    <div style="font-family:sans-serif; text-align:center; padding:40px;">
        <h2 style="color:green;">✅ ፓስዎርድ ተቀይሯል!</h2>
        <p><b>${r.name}</b> (${r.user_id})</p>
        <p style="font-size:22px; background:#f0f0f0; display:inline-block; padding:10px 20px; border-radius:8px;">አዲስ Password: <b>${newPass}</b></p>
        <p style="color:#555;">ይህን ፓስዎርድ ለተጠቃሚው በስልክ/በአካል ይስጡት።</p>
        <br><a href="/admin" style="font-weight:bold;">⬅ ወደ Admin ተመለስ</a>
    </div>`);
});

// ================== PRE-APPROVED LIST (Excel + Manual) ==================
app.get('/admin/pre-approved', async (req, res) => {
    if (!req.session.isAdminLoggedIn) return res.redirect('/');
    const list = await PreApproved.find().sort({ full_name: 1 });
    const available = list.filter(x => x.status === 'Available').length;
    const used = list.filter(x => x.status === 'Used').length;

    const rows = list.map(r => `
        <tr style="${r.status === 'Used' ? 'background:#f5f5f5; color:#888;' : ''}">
            <td>${r.full_name}</td>
            <td>${r.father_name || '-'}</td>
            <td>${r.phone || '-'}</td>
            <td>${r.department || '-'}</td>
            <td>${r.year_level || '-'}</td>
            <td>${r.gender || '-'}</td>
            <td>${r.status === 'Available' ? '<span style="color:green;font-weight:bold;">Available</span>' : '<span style="color:#888;">Used</span>'}</td>
            <td>${r.used_by_student_id || '-'}</td>
            <td>${r.source || '-'}</td>
            <td>
                ${r.status === 'Available' ? `<a href="/admin/pre-approved/delete/${r._id}" style="background:#c0392b;color:white;padding:3px 8px;text-decoration:none;border-radius:4px;" onclick="return confirm('ሰርዝ?')">🗑</a>` : '-'}
            </td>
        </tr>
    `).join('') || '<tr><td colspan="10">ዝርዝር ባዶ ነው — Excel ስቀም ወይም በእጅ ጨምር</td></tr>';

    res.send(`
    <!DOCTYPE html>
    <html lang="am">
    <head><meta charset="UTF-8"><title>Pre-Approved List</title>
    <style>
        body { font-family: sans-serif; background:#eef2f5; padding:15px; font-size:13px; }
        .card { background:white; padding:16px; border-radius:10px; margin-bottom:16px; overflow-x:auto; }
        table { width:100%; border-collapse:collapse; min-width:800px; }
        th, td { border:1px solid #ddd; padding:6px; text-align:center; }
        th { background:#1f4e79; color:white; }
        input, select { padding:8px; margin:4px 0 10px; border:1px solid #ccc; border-radius:6px; width:100%; box-sizing:border-box; }
        .btn { display:inline-block; padding:10px 16px; border-radius:6px; color:white; text-decoration:none; font-weight:bold; border:none; cursor:pointer; }
    </style></head>
    <body>
        <h2>📋 ቅድመ-ዝርዝር (Pre-Approved Students)</h2>
        <p>Available: <b style="color:green;">${available}</b> &nbsp;|&nbsp; Used: <b>${used}</b> &nbsp;|&nbsp; Total: <b>${list.length}</b></p>

        <div class="card">
            <h3 style="margin-top:0;">📤 Excel / CSV ስቀም</h3>
            <p style="font-size:12px; color:#555;">አምዶች (headers): <b>full_name</b>, father_name, phone, department, year_level, gender<br>
            አስፈላጊው አምድ <b>full_name</b> ብቻ ነው። ስሞች ከተማሪው ምዝገባ ጋር መመሳሰል አለባቸው።</p>
            <form action="/admin/pre-approved/upload" method="POST" enctype="multipart/form-data">
                <input type="file" name="excel_file" accept=".xlsx,.xls,.csv" required>
                <button type="submit" class="btn" style="background:#27ae60; margin-top:8px;">⬆ ስቀም (Upload)</button>
            </form>
            <p style="margin-top:12px;"><a href="/admin/pre-approved/template" class="btn" style="background:#8e44ad;">⬇ Sample Excel Template አውርድ</a></p>
            ${!XLSX ? '<p style="color:#c0392b;">⚠️ xlsx package አልተጫነም። <code>npm install xlsx</code> አድርግ። CSV ግን ይሰራል።</p>' : ''}
        </div>

        <div class="card">
            <h3 style="margin-top:0;">➕ በእጅ አንድ ስም ጨምር</h3>
            <form action="/admin/pre-approved/add" method="POST">
                <label>ሙሉ ስም (Full Name) *:</label>
                <input type="text" name="full_name" required>
                <label>የአባት ስም:</label>
                <input type="text" name="father_name">
                <label>ስልክ:</label>
                <input type="text" name="phone">
                <label>Department:</label>
                <input type="text" name="department">
                <label>Year Level:</label>
                <select name="year_level">
                    <option value="1st Year">1st Year</option>
                    <option value="2nd Year">2nd Year</option>
                    <option value="3rd Year">3rd Year</option>
                </select>
                <label>Gender:</label>
                <select name="gender"><option value="">-</option><option value="Male">Male</option><option value="Female">Female</option></select>
                <button type="submit" class="btn" style="background:#2980b9;">➕ ጨምር</button>
            </form>
        </div>

        <div class="card">
            <h3 style="margin-top:0;">የዝርዝሩ ይዘት</h3>
            <p style="font-size:12px;"><a href="/admin/pre-approved/clear-available" onclick="return confirm('ሁሉንም Available ሰዎች ሰርዝ?')" style="color:#c0392b;">🗑 ሁሉንም Available አጽዳ</a></p>
            <table>
                <thead>
                    <tr>
                        <th>Full Name</th><th>Father</th><th>Phone</th><th>Dept</th><th>Year</th><th>Gender</th>
                        <th>Status</th><th>Used By ID</th><th>Source</th><th>Del</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
        <a href="/admin">⬅ ወደ Admin ተመለስ</a>
    </body></html>
    `);
});

app.get('/admin/pre-approved/template', (req, res) => {
    if (!req.session.isAdminLoggedIn) return res.redirect('/');
    // Simple CSV template (works without xlsx)
    const csv = 'full_name,father_name,phone,department,year_level,gender\nAbebe Kebede,Kebede,0911223344,Computer Science,1st Year,Male\nSara Alemu,Alemu,0922334455,Statistics,1st Year,Female\n';
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=pre_approved_template.csv');
    res.send(csv);
});

app.post('/admin/pre-approved/upload', upload.single('excel_file'), async (req, res) => {
    if (!req.session.isAdminLoggedIn) return res.redirect('/');
    if (!req.file) return res.send('<h3>ፋይል አልተገኘም <a href="/admin/pre-approved">ተመለስ</a></h3>');

    const filePath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();
    let rows = [];

    try {
        if (ext === '.csv') {
            const text = fs.readFileSync(filePath, 'utf8');
            const lines = text.split(/\r?\n/).filter(l => l.trim());
            if (lines.length < 2) throw new Error('CSV ባዶ ወይም header ብቻ');
            const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
            for (let i = 1; i < lines.length; i++) {
                const cols = lines[i].split(',').map(c => c.trim());
                const obj = {};
                headers.forEach((h, idx) => { obj[h] = cols[idx] || ''; });
                rows.push(obj);
            }
        } else if (ext === '.xlsx' || ext === '.xls') {
            if (!XLSX) {
                fs.unlinkSync(filePath);
                return res.send('<h3 style="color:red;">xlsx package አልተጫነም። <code>npm install xlsx</code> አድርግ። ወይም CSV ስቀም። <a href="/admin/pre-approved">ተመለስ</a></h3>');
            }
            const wb = XLSX.readFile(filePath);
            const sheet = wb.Sheets[wb.SheetNames[0]];
            rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        } else {
            fs.unlinkSync(filePath);
            return res.send('<h3>የማይደገፍ ፋይል አይነት። .xlsx / .csv ብቻ። <a href="/admin/pre-approved">ተመለስ</a></h3>');
        }

        let added = 0, skipped = 0;
        const now = new Date().toLocaleString();

        for (const row of rows) {
            // Flexible header names
            const full_name = (row.full_name || row.fullname || row.Full_Name || row['Full Name'] || row.name || '').toString().trim();
            if (!full_name) { skipped++; continue; }

            const father_name = (row.father_name || row.Father_Name || row['Father Name'] || row.father || '').toString().trim();
            const phone = (row.phone || row.Phone || row.mobile || '').toString().trim();
            const department = (row.department || row.Department || row.dept || '').toString().trim();
            const year_level = (row.year_level || row.Year_Level || row['Year Level'] || row.year || '').toString().trim();
            const gender = (row.gender || row.Gender || '').toString().trim();

            // Skip exact duplicate Available entry
            const exists = await PreApproved.findOne({
                full_name: new RegExp('^' + full_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i'),
                status: 'Available'
            });
            if (exists) { skipped++; continue; }

            await PreApproved.create({
                full_name,
                father_name: father_name || undefined,
                phone: phone || undefined,
                department: department || undefined,
                year_level: year_level || undefined,
                gender: gender || undefined,
                status: 'Available',
                source: 'excel',
                uploaded_at: now
            });
            added++;
        }

        try { fs.unlinkSync(filePath); } catch (e) {}

        await Notification.create({
            type: 'PRE_APPROVED_UPLOAD',
            message: `📋 ቅድመ-ዝርዝር ተጭኗል: ${added} አዲስ, ${skipped} ተዘለሉ`,
            time: new Date().toLocaleString()
        });

        res.send(`<div style="font-family:sans-serif;text-align:center;padding:40px;"><h2 style="color:green;">✅ Upload ተሳክቷል</h2><p>${added} ስሞች ተጨመሩ · ${skipped} ተዘለሉ (ባዶ/ድጋሚ)</p><br><a href="/admin/pre-approved">⬅ ወደ ዝርዝር</a></div>`);
    } catch (err) {
        try { fs.unlinkSync(filePath); } catch (e) {}
        res.send(`<div style="font-family:sans-serif;text-align:center;padding:40px;"><h2 style="color:red;">❌ ስህተት</h2><p>${err.message}</p><br><a href="/admin/pre-approved">ተመለስ</a></div>`);
    }
});

app.post('/admin/pre-approved/add', async (req, res) => {
    if (!req.session.isAdminLoggedIn) return res.redirect('/');
    const { full_name, father_name, phone, department, year_level, gender } = req.body;
    if (!full_name || !full_name.trim()) return res.redirect('/admin/pre-approved');

    await PreApproved.create({
        full_name: full_name.trim(),
        father_name: (father_name || '').trim() || undefined,
        phone: (phone || '').trim() || undefined,
        department: (department || '').trim() || undefined,
        year_level: year_level || undefined,
        gender: gender || undefined,
        status: 'Available',
        source: 'manual',
        uploaded_at: new Date().toLocaleString()
    });
    res.redirect('/admin/pre-approved');
});

app.get('/admin/pre-approved/delete/:id', async (req, res) => {
    if (!req.session.isAdminLoggedIn) return res.redirect('/');
    await PreApproved.findByIdAndDelete(req.params.id);
    res.redirect('/admin/pre-approved');
});

app.get('/admin/pre-approved/clear-available', async (req, res) => {
    if (!req.session.isAdminLoggedIn) return res.redirect('/');
    await PreApproved.deleteMany({ status: 'Available' });
    res.redirect('/admin/pre-approved');
});

app.get('/admin/add-course', async (req, res) => {
    if (!req.session.isAdminLoggedIn) return res.redirect('/');
    res.send(`
    <div style="font-family:sans-serif; padding:20px; max-width:500px; margin:auto;">
        <h2>📚 አዲስ ኮርስ መፍጠር</h2>
        <form action="/admin/create-course" method="POST">
            <label>የኮርስ ስም:</label><br>
            <input type="text" name="course_name" required style="width:100%; padding:8px; margin-bottom:10px;"><br>
            <label>ክፍል/ሴክሽን (ለምሳሌ: 1st Year - Section A):</label><br>
            <input type="text" name="class_level" required style="width:100%; padding:8px; margin-bottom:10px;"><br>
            <label>የመምህር ስም:</label><br>
            <input type="text" name="teacher_name" required style="width:100%; padding:8px; margin-bottom:10px;"><br>
            <label>ቀን (ለምሳሌ: Mon):</label><br>
            <input type="text" name="day" required style="width:100%; padding:8px; margin-bottom:10px;"><br>
            <label>ሰዓት (ለምሳሌ: 08:00 - 10:00 AM):</label><br>
            <input type="text" name="time" required style="width:100%; padding:8px; margin-bottom:10px;"><br>
            <label>ክፍል ቁጥር/Room:</label><br>
            <input type="text" name="room" required style="width:100%; padding:8px; margin-bottom:15px;"><br>
            <button type="submit" style="background:#27ae60; color:white; border:none; padding:12px; width:100%; border-radius:6px; font-weight:bold;">➕ ኮርስ ጨምር</button>
        </form>
        <br><a href="/admin">⬅ ወደ Admin ተመለስ</a>
    </div>`);
});

app.post('/admin/create-course', async (req, res) => {
    if (!req.session.isAdminLoggedIn) return res.redirect('/');
    const { course_name, class_level, teacher_name, day, time, room } = req.body;
    await Course.create({ course_name, class_level, teacher_name, day, time, room });
    res.redirect('/admin/add-course');
});

app.get('/admin/add-teacher', async (req, res) => {
    if (!req.session.isAdminLoggedIn) return res.redirect('/');
    res.send(`
    <div style="font-family:sans-serif; padding:20px; max-width:500px; margin:auto;">
        <h2>👨‍🏫 አዲስ መምህር መመዝገብ</h2>
        <form action="/admin/create-teacher" method="POST">
            <label>የመምህር ID (ለምሳሌ T-103):</label><br>
            <input type="text" name="teacher_id" required style="width:100%; padding:8px; margin-bottom:10px;"><br>
            <label>ሙሉ ስም:</label><br>
            <input type="text" name="name" required style="width:100%; padding:8px; margin-bottom:10px;"><br>
            <label>ትምህርት ክፍል (Department):</label><br>
            <input type="text" name="dept" required style="width:100%; padding:8px; margin-bottom:10px;"><br>
            <label>ፓስዎርድ:</label><br>
            <input type="text" name="pass" required style="width:100%; padding:8px; margin-bottom:10px;"><br>
            <label>ስልክ ቁጥር:</label><br>
            <input type="text" name="phone" required style="width:100%; padding:8px; margin-bottom:10px;"><br>
            <label>የተመደበበት ሴክሽን (ለምሳሌ: 1st Year - Section A):</label><br>
            <input type="text" name="assigned_section" required style="width:100%; padding:8px; margin-bottom:15px;"><br>
            <button type="submit" style="background:#2980b9; color:white; border:none; padding:12px; width:100%; border-radius:6px; font-weight:bold;">➕ መምህር ጨምር</button>
        </form>
        <br><a href="/admin">⬅ ወደ Admin ተመለስ</a>
    </div>`);
});

app.post('/admin/create-teacher', async (req, res) => {
    if (!req.session.isAdminLoggedIn) return res.redirect('/');
    const { teacher_id, name, dept, pass, phone, assigned_section } = req.body;

    const existing = await Teacher.findOne({ teacher_id: teacher_id.trim() });
    if (existing) {
        return res.send('<h3 style="color:red; text-align:center; margin-top:50px;">❌ ይህ Teacher ID አስቀድሞ አለ! <a href="/admin/add-teacher">ተመለስ</a></h3>');
    }

    await Teacher.create({
        teacher_id: teacher_id.trim(), name: name.trim(), dept: dept.trim(),
        pass: pass.trim(), phone: phone.trim(), assigned_section: assigned_section.trim()
    });

    res.redirect('/admin/add-teacher');
});

app.get('/admin/verify-payment/:id', async (req, res) => {
    if (!req.session.isAdminLoggedIn) return res.redirect('/');
    await Student.findOneAndUpdate({ student_id: req.params.id }, { payment_status: 'Verified' });
    await Notification.create({
        type: 'PAYMENT_VERIFIED',
        message: `የ${req.params.id} ክፍያ ተረጋግጧል`,
        time: new Date().toLocaleString()
    });
    res.redirect('/admin');
});
app.get('/admin/respond-withdrawal/:id', async (req, res) => {
    if (!req.session.isAdminLoggedIn) return res.redirect('/');
    const w = await Withdrawal.findById(req.params.id);
    if (!w) return res.redirect('/admin');
    res.send(`
    <div style="font-family:sans-serif; padding:20px; max-width:500px; margin:auto;">
        <h2>📩 ለ${w.student_name} ምላሽ ስጥ</h2>
        <p><b>ምክንያት:</b> ${w.reason}</p>
        <form action="/admin/submit-withdrawal-response/${w._id}" method="POST">
            <textarea name="admin_response" placeholder="ምላሽዎን እዚህ ይጻፉ..." required style="width:100%; padding:8px; margin-bottom:10px;" rows="4"></textarea>
            <select name="status" style="width:100%; padding:8px; margin-bottom:10px;">
                <option value="Approved">✅ Approved (ተፈቅዷል)</option>
                <option value="Rejected">❌ Rejected (ውድቅ ተደርጓል)</option>
            </select>
            <button type="submit" style="background:#27ae60; color:white; border:none; padding:12px; width:100%; border-radius:6px; font-weight:bold;">📤 ላክ</button>
        </form>
        <br><a href="/admin">⬅ ወደ Admin ተመለስ</a>
    </div>`);
});

app.post('/admin/submit-withdrawal-response/:id', async (req, res) => {
    if (!req.session.isAdminLoggedIn) return res.redirect('/');
    await Withdrawal.findByIdAndUpdate(req.params.id, {
        status: req.body.status, admin_response: req.body.admin_response
    });
    res.redirect('/admin');
});

app.get('/admin/approve-student/:id', async (req, res) => {
    if (!req.session.isAdminLoggedIn) return res.redirect('/');
    const pending = await PendingStudent.findById(req.params.id);
    if (pending) {
        await Student.create({
            student_id: pending.student_id, password: pending.password, name: pending.name,
            father_name: pending.father_name, mother_name: pending.mother_name, gender: pending.gender,
            age: pending.age, phone: pending.phone, department: pending.department,
            class_level: pending.class_level, bank_slip_val: pending.bank_slip_val, photo: pending.photo,
            status: "Approved", admin_message: "🎉 ምዝገባዎ ጸድቋል!"
        });
        await PendingStudent.findByIdAndDelete(req.params.id);
    }
    res.redirect('/admin');
});

app.get('/admin/edit-teacher/:id', async (req, res) => {
    if (!req.session.isAdminLoggedIn) return res.redirect('/');
    let t = await Teacher.findOne({ teacher_id: req.params.id });
    if (!t) return res.redirect('/admin');
    res.send(`
    <div style="font-family:sans-serif; padding:30px; max-width:420px; margin:auto; background:#fff; border-radius:10px;">
        <h2>✏️ መምህር ማስተካከል / Password Reset</h2>
        <p style="background:#f5f5f5; padding:10px; border-radius:6px; font-size:13px;">
            <b>ID:</b> ${t.teacher_id}<br>
            <b>Dept:</b> ${t.dept || '-'}<br>
            <b>Phone:</b> ${t.phone || '-'}
        </p>
        <form action="/admin/update-teacher/${t.teacher_id}" method="POST">
            <label>ስም:</label><input type="text" name="name" value="${t.name}" style="width:100%; padding:8px; margin-bottom:10px;" required>
            <label>ፓስዎርድ (Password) — እዚህ ቀይር:</label>
            <input type="text" name="pass" value="${t.pass}" style="width:100%; padding:8px; margin-bottom:10px; border:2px solid #e67e22;" required>
            <label>ስልክ:</label><input type="text" name="phone" value="${t.phone || ''}" style="width:100%; padding:8px; margin-bottom:10px;">
            <label>የተመደበበት ሴክሽን:</label><input type="text" name="assigned_section" value="${t.assigned_section}" style="width:100%; padding:8px; margin-bottom:15px;" required>
            <button type="submit" style="background:green; color:white; padding:12px; width:100%; border:none; border-radius:6px; font-weight:bold;">💾 አስቀምጥ / Reset Password</button>
        </form>
        <br><a href="/admin">⬅ ወደ Admin ተመለስ</a>
    </div>`);
});

app.post('/admin/update-teacher/:id', async (req, res) => {
    if (!req.session.isAdminLoggedIn) return res.redirect('/');
    await Teacher.findOneAndUpdate({ teacher_id: req.params.id }, {
        name: req.body.name,
        pass: req.body.pass,
        phone: req.body.phone,
        assigned_section: req.body.assigned_section
    });
    res.redirect('/admin');
});

app.get('/admin/edit-student/:id', async (req, res) => {
    if (!req.session.isAdminLoggedIn) return res.redirect('/');
    let st = await Student.findOne({ student_id: req.params.id });
    if (!st) return res.redirect('/admin');
    res.send(`
    <div style="font-family:sans-serif; padding:30px; max-width:420px; margin:auto; background:#fff; border-radius:10px;">
        <h2>✏️ ተማሪ ማስተካከል / Password Reset</h2>
        <p style="background:#f5f5f5; padding:10px; border-radius:6px; font-size:13px;">
            <b>ID:</b> ${st.student_id}<br>
            <b>Father:</b> ${st.father_name || '-'} | <b>Mother:</b> ${st.mother_name || '-'}<br>
            <b>Gender:</b> ${st.gender || '-'} | <b>Age:</b> ${st.age || '-'}<br>
            <b>Dept:</b> ${st.department || '-'} | <b>Phone:</b> ${st.phone || '-'}
        </p>
        <form action="/admin/update-student/${st.student_id}" method="POST">
            <label>ሙሉ ስም:</label><input type="text" name="name" value="${st.name}" style="width:100%; padding:8px; margin-bottom:10px;" required>
            <label>ፓስዎርድ (PIN) — እዚህ ቀይር:</label>
            <input type="text" name="password" value="${st.password}" style="width:100%; padding:8px; margin-bottom:10px; border:2px solid #e67e22;" required>
            <label>ስልክ:</label><input type="text" name="phone" value="${st.phone || ''}" style="width:100%; padding:8px; margin-bottom:10px;">
            <label>ሴክሽን:</label><input type="text" name="class_level" value="${st.class_level}" style="width:100%; padding:8px; margin-bottom:15px;" required>
            <button type="submit" style="background:green; color:white; padding:12px; width:100%; border:none; border-radius:6px; font-weight:bold;">💾 አስቀምጥ / Reset Password</button>
        </form>
        <br><a href="/admin">⬅ ወደ Admin ተመለስ</a>
    </div>`);
});

app.post('/admin/update-student/:id', async (req, res) => {
    if (!req.session.isAdminLoggedIn) return res.redirect('/');
    await Student.findOneAndUpdate({ student_id: req.params.id }, {
        name: req.body.name,
        password: req.body.password,
        phone: req.body.phone,
        class_level: req.body.class_level
    });
    res.redirect('/admin');
});

app.get('/teacher-dashboard', async (req, res) => {
    if (!req.session.teacherId) return res.redirect('/');
    let teacher = await Teacher.findOne({ teacher_id: req.session.teacherId });
    if (!teacher) return res.redirect('/');
    let assignedSec = teacher.assigned_section;
    let secAssessments = await Assessment.find({ section: assignedSec });

    let assessmentRows = secAssessments.map(a => `
        <div style="background:#f9f9f9; padding:8px; margin-bottom:8px; border-left:3px solid green;"><b>${a.title}</b> - ${a.deadline}</div>
    `).join('') || '<p>እስካሁን የተለቀቀ የለም</p>';

    let recentGrades = await Grade.find({ teacherName: teacher.name }).sort({ _id: -1 }).limit(15);
    let gradeRows = recentGrades.map(g => `
        <div style="background:#f5f0fa; padding:6px 10px; margin-bottom:5px; border-left:3px solid #8e44ad; font-size:13px;">
            🎓 ${g.student_id} — ${g.course_name} (${g.assessment_type}): <b>${g.score}/${g.max_score}</b>
        </div>
    `).join('') || '<p>እስካሁን ውጤት አልተሰጠም</p>';

    res.send(`
    <!DOCTYPE html>
    <html lang="am">
    <head><meta charset="UTF-8"><title>Teacher Dashboard</title>
    <style>body { font-family: sans-serif; background: #eef2f5; padding: 20px; } .card { background: white; padding: 20px; border-radius: 10px; max-width: 600px; margin: auto; }</style></head>
    <body><div class="card">
        <h2>👨‍🏫 መምህር ${teacher.name} ዳሽቦርድ</h2>
        <p>ሴክሽን: <b>${assignedSec}</b></p><hr>
        <h3>📝 አዲስ Assessment መፍጠር እና መላክ</h3>
        <form action="/teacher/create-assessment" method="POST">
            <input type="hidden" name="section" value="${assignedSec}">
            <label>ርዕስ (Title):</label><br><input type="text" name="title" required style="width:100%; padding:8px; margin-bottom:8px;"><br>
            <label>መግለጫ (Description):</label><br><textarea name="description" rows="3" required style="width:100%; padding:8px; margin-bottom:8px;"></textarea><br>
            <label>ማስረከቢያ ቀን (Deadline):</label><br><input type="text" name="deadline" required style="width:100%; padding:8px; margin-bottom:12px;"><br>
            <button type="submit" style="background:#27ae60; color:white; border:none; padding:10px; width:100%; border-radius:6px; font-weight:bold;">📤 ለተማሪዎች ላክ</button>
        </form><hr>
        <h3>📋 የለቀቋቸው Assessments</h3>${assessmentRows}
        <hr>
        <h3>🎯 ውጤት መስጫ (Give Grade)</h3>
        <form action="/teacher/give-grade" method="POST">
            <input type="hidden" name="section" value="${assignedSec}">
            <label>የኮርስ ስም:</label><br>
            <input type="text" name="course_name" required style="width:100%; padding:8px; margin-bottom:8px;"><br>
            <label>የተማሪ ID (ለምሳሌ MWU-1234):</label><br>
            <input type="text" name="student_id" required style="width:100%; padding:8px; margin-bottom:8px; text-transform:uppercase;"><br>
            <label>የምዘና አይነት (ለምሳሌ: Midterm, Quiz 1, Final):</label><br>
            <input type="text" name="assessment_type" required style="width:100%; padding:8px; margin-bottom:8px;"><br>
            <label>ውጤት:</label><br>
            <input type="number" name="score" required style="width:48%; padding:8px; margin-bottom:8px; display:inline-block;">
            <label style="display:inline-block; width:4%; text-align:center;">/</label>
            <input type="number" name="max_score" required placeholder="ከፍተኛ ውጤት" style="width:48%; padding:8px; margin-bottom:12px; display:inline-block;"><br>
            <button type="submit" style="background:#8e44ad; color:white; border:none; padding:10px; width:100%; border-radius:6px; font-weight:bold;">✅ ውጤት አስመዝግብ</button>
        </form>
        <hr>
        <h3>📊 ያስመዘገብካቸው ውጤቶች</h3>
        ${gradeRows}
    </div>
    <div style="text-align:center; margin-top:20px;"><a href="/logout" style="color:red; font-weight:bold;">🔒 Logout</a></div>
    </body></html>
    `);
});

app.post('/teacher/give-grade', async (req, res) => {
    if (!req.session.teacherId) return res.redirect('/');
    const { course_name, student_id, assessment_type, score, max_score } = req.body;
    let teacher = await Teacher.findOne({ teacher_id: req.session.teacherId });

    const student = await Student.findOne({ student_id: student_id.trim().toUpperCase() });
    if (!student) {
        return res.send('<h3 style="color:red; text-align:center; margin-top:50px;">❌ ይህ የተማሪ ID አልተገኘም! <a href="/teacher-dashboard">ተመለስ</a></h3>');
    }

    await Grade.create({
        student_id: student_id.trim().toUpperCase(),
        course_name: course_name.trim(),
        assessment_type: assessment_type.trim(),
        score: Number(score),
        max_score: Number(max_score),
        teacherName: teacher.name,
        date: new Date().toLocaleString()
    });

    await Notification.create({
        type: 'GRADE_GIVEN',
        message: `መምህር ${teacher.name} ለ ${student_id.trim().toUpperCase()} ውጤት አስመዘገበ (${course_name})`,
        time: new Date().toLocaleString()
    });

    res.redirect('/teacher-dashboard');
});

app.post('/teacher/create-assessment', async (req, res) => {
    if (!req.session.teacherId) return res.redirect('/');
    const { section, title, description, deadline } = req.body;
    let teacher = await Teacher.findOne({ teacher_id: req.session.teacherId });

    await Assessment.create({ section, teacherName: teacher.name, title, description, deadline });

    await Notification.create({
        type: 'TEACHER_ASSESSMENT',
        message: `መምህር ${teacher.name} ለ ${section} አዲስ Assessment አወጣ (${title})`,
        time: new Date().toLocaleString()
    });

    res.redirect('/teacher-dashboard');
});

app.get('/student-dashboard', async (req, res) => {
    if (!req.session.studentId) return res.redirect('/');
    const student = await Student.findOne({ student_id: req.session.studentId });
    if (!student) return res.redirect('/');

    let secCourses = await Course.find({ class_level: student.class_level });
    let secAssessments = await Assessment.find({ section: student.class_level });
    let assessmentHtml = secAssessments.map(a => `<div style="background:#eef9f2; padding:10px; margin-bottom:8px; border:1px solid green;"><b>${a.title}</b><p>${a.description}</p><small>አስተማሪ: ${a.teacherName} | ቀን: ${a.deadline}</small></div>`).join('') || '<p>አሳይንመንት የለም</p>';

    let grades = await Grade.find({ student_id: student.student_id }).sort({ _id: -1 });
    let gradeHtml = grades.map(g => `
        <tr><td style="padding:6px; border:1px solid #ddd;">${g.course_name}</td><td style="padding:6px; border:1px solid #ddd;">${g.assessment_type}</td><td style="padding:6px; border:1px solid #ddd;">${g.score}/${g.max_score}</td></tr>
    `).join('') || '<tr><td colspan="3" style="padding:6px; border:1px solid #ddd;">ውጤት እስካሁን የለም</td></tr>';

    let courseRows = secCourses.map(c => `
        <tr><td style="padding:6px; border:1px solid #ddd;">${c.course_name}</td><td style="padding:6px; border:1px solid #ddd;">${c.teacher_name}</td><td style="padding:6px; border:1px solid #ddd;">${c.day}</td><td style="padding:6px; border:1px solid #ddd;">${c.time}</td><td style="padding:6px; border:1px solid #ddd;">${c.room}</td></tr>
    `).join('') || '<tr><td colspan="5" style="padding:6px; border:1px solid #ddd;">ኮርስ የለም</td></tr>';

    res.send(`
    <!DOCTYPE html>
    <html lang="am">
    <head><meta charset="UTF-8"><title>Student Dashboard</title>
    <style>body { font-family: sans-serif; background: #f4f7f6; padding: 20px; } .container { max-width: 600px; margin: auto; background: white; padding: 20px; border-radius: 10px; }</style></head>
    <body><div class="container">
        <h2>🎓 የተማሪ ዳሽቦርድ</h2>
        <p>ስም: <b>${student.name}</b> | ሴክሽን: <b>${student.class_level}</b></p>
        <div style="background:${student.payment_status === 'Verified' ? '#d4edda' : '#fff3cd'}; padding:10px; border-radius:6px; margin-bottom:10px; text-align:center; font-weight:bold; color:${student.payment_status === 'Verified' ? '#155724' : '#856404'};">
            ${student.payment_status === 'Verified' ? '✅ Registered - ምዝገባዎ ተረጋግጧል' : '⏳ Pending - ክፍያዎ በመጠባበቅ ላይ ነው'}
        </div>
        <hr>
        <h3>📚 የክፍልዎ ኮርሶች (Courses)</h3>
        <table style="width:100%; border-collapse:collapse; margin-bottom:15px;">
            <thead><tr style="background:#1f4e79; color:white;"><th style="padding:6px; border:1px solid #ddd;">ኮርስ</th><th style="padding:6px; border:1px solid #ddd;">መምህር</th><th style="padding:6px; border:1px solid #ddd;">ቀን</th><th style="padding:6px; border:1px solid #ddd;">ሰዓት</th><th style="padding:6px; border:1px solid #ddd;">ክፍል</th></tr></thead>
            <tbody>${courseRows}</tbody>
        </table>
        <h3>📥 የአስተማሪዎች Assessments</h3>${assessmentHtml}
        <h3>🎯 ውጤትዎ (Grades)</h3>
        <table style="width:100%; border-collapse:collapse; margin-bottom:15px;">
            <thead><tr style="background:#8e44ad; color:white;"><th style="padding:6px; border:1px solid #ddd;">ኮርስ</th><th style="padding:6px; border:1px solid #ddd;">አይነት</th><th style="padding:6px; border:1px solid #ddd;">ውጤት</th></tr></thead>
            <tbody>${gradeHtml}</tbody>
        </table>
        <hr>
        <h3>📝 Withdrawal Form (ትምህርት ማቋረጫ)</h3>
        <form action="/student/withdraw" method="POST">
            <textarea name="reason" placeholder="ምክንያትዎን እዚህ ይጻፉ..." required style="width:100%; padding:8px; margin-bottom:8px;" rows="3"></textarea>
            <button type="submit" style="background:#c0392b; color:white; border:none; padding:10px; width:100%; border-radius:6px; font-weight:bold;">📤 ላክ</button>
        </form>
        <br><a href="/logout" style="color:red; font-weight:bold;">🔒 Logout</a>
    </div></body></html>
    `);
});
app.get('/admin/id-card/:id', async (req, res) => {
    if (!req.session.isAdminLoggedIn) return res.redirect('/');
    const student = await Student.findOne({ student_id: req.params.id });
    if (!student) return res.redirect('/admin');

    try {
        const barcodeBuffer = await bwipjs.toBuffer({
            bcid: 'code128',
            text: student.student_id,
            scale: 3,
            height: 10,
            includetext: true,
            textxalign: 'center',
        });

        const doc = new PDFDocument({ size: [340, 220], margin: 0 });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=ID-${student.student_id}.pdf`);
        doc.pipe(res);

        doc.rect(0, 0, 340, 220).fill('#1f4e79');
        doc.rect(0, 0, 340, 45).fill('#ffffff');
        doc.fillColor('#1f4e79').fontSize(16).font('Helvetica-Bold').text('MADDA WALABU UNIVERSITY', 10, 12);
        doc.fillColor('#1f4e79').fontSize(9).text('STUDENT ID CARD', 10, 30);

        if (student.photo && fs.existsSync(path.join('uploads', student.photo))) {
            doc.image(path.join('uploads', student.photo), 15, 55, { width: 80, height: 90 });
        } else {
            doc.rect(15, 55, 80, 90).fill('#ffffff');
        }

        doc.fillColor('#ffffff').fontSize(11).font('Helvetica-Bold');
        doc.text(`Name: ${student.name}`, 105, 55);
        doc.fontSize(9).font('Helvetica');
        doc.text(`ID: ${student.student_id}`, 105, 75);
        doc.text(`Department: ${student.department}`, 105, 92);
        doc.text(`Class: ${student.class_level}`, 105, 109);
        doc.text(`Gender: ${student.gender}`, 105, 126);

        doc.image(barcodeBuffer, 15, 155, { width: 310, height: 50 });

        doc.end();
    } catch (err) {
        res.status(500).send('Error generating ID card: ' + err.message);
    }
});
app.post('/student/withdraw', async (req, res) => {
    if (!req.session.studentId) return res.redirect('/');
    const student = await Student.findOne({ student_id: req.session.studentId });
    if (!student) return res.redirect('/');

    await Withdrawal.create({
        student_id: student.student_id, student_name: student.name,
        reason: req.body.reason, date: new Date().toLocaleString()
    });

    await Notification.create({
        type: 'WITHDRAWAL_REQUEST',
        message: `${student.name} (${student.student_id}) withdrawal ጠይቋል`,
        time: new Date().toLocaleString()
    });

    res.send('<div style="font-family:sans-serif; text-align:center; padding:30px;"><h2 style="color:green;">✅ የመልቀቂያ ጥያቄዎ ተልኳል!</h2><p>አድሚን ምላሽ እስኪሰጥ ይጠብቁ።</p><br><a href="/student-dashboard">ወደ ዳሽቦርድ ተመለስ</a></div>');
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
