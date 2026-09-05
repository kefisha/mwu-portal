const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

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
    status: String, admin_message: String
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
        <form action="/api/student-self-register" method="POST" enctype="multipart/form-data">
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
            <button type="submit" style="background:#27ae60; color:white; border:none; padding:12px; width:100%; border-radius:8px; font-weight:bold; cursor:pointer;">🚀 ምዝገባውን ለአድሚን ላክ</button>
        </form>
    </div></body></html>
    `);
});

const registerUpload = upload.fields([{ name: 'student_photo', maxCount: 1 }]);

app.post('/api/student-self-register', registerUpload, async (req, res) => {
    const { name, father_name, mother_name, gender, age, phone, department, year_level, txn_id } = req.body;
    let autoID = generateStudentID();
    let autoPIN = generate4DigitPIN();
    let assignedSection = await assignClassSection(year_level);
    let photoPath = req.files && req.files['student_photo'] ? req.files['student_photo'][0].filename : '';

    await PendingStudent.create({
        student_id: autoID, password: autoPIN, name: name.trim(), father_name, mother_name,
        gender, age, phone, department: department.trim(), class_level: assignedSection,
        bank_slip_val: txn_id, photo: photoPath
    });

    await Notification.create({
        type: 'STUDENT_REGISTRATION',
        message: `አዲስ ተማሪ ተመዝግቧል: ${name.trim()} (${assignedSection})`,
        time: new Date().toLocaleString()
    });

    res.send(`<div style="font-family:sans-serif; text-align:center; padding:30px;"><h2 style="color:green;">✅ ምዝገባዎ ተልኳል!</h2><p>የተመደቡበት ID: <b>${autoID}</b> እና PIN: <b>${autoPIN}</b></p><br><a href="/">ወደ መግቢያ ተመለስ</a></div>`);
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

app.get('/admin', async (req, res) => {
    if (!req.session.isAdminLoggedIn) return res.redirect('/');

    const pendingStudents = await PendingStudent.find();
    const teachers = await Teacher.find();
    const students = await Student.find();
    const notifications = await Notification.find().sort({ _id: -1 }).limit(20);

    let pendingRows = pendingStudents.map(st => `
        <tr><td>${st.student_id}</td><td><b>${st.password}</b></td><td>${st.name}</td><td>${st.class_level}</td>
        <td><a href="/admin/approve-student/${st._id}" style="background:green; color:white; padding:4px 8px; text-decoration:none; border-radius:4px;">✅ Approve</a></td></tr>
    `).join('') || '<tr><td colspan="5">ምንም አዲስ ጥያቄ የለም</td></tr>';

    let teacherRows = teachers.map(t => `
        <tr><td>${t.teacher_id}</td><td><b>${t.pass}</b></td><td>${t.name}</td><td>${t.dept}</td><td>${t.assigned_section}</td>
        <td><a href="/admin/edit-teacher/${t.teacher_id}" style="background:#2980b9; color:white; padding:3px 6px; text-decoration:none; border-radius:4px;">✏️ Edit</a></td></tr>
    `).join('');

    let studentRows = students.map(st => `
        <tr><td>${st.student_id}</td><td><b>${st.password}</b></td><td>${st.name}</td><td>${st.class_level}</td>
        <td><a href="/admin/edit-student/${st.student_id}" style="background:#2980b9; color:white; padding:3px 6px; text-decoration:none; border-radius:4px;">✏️ Edit</a></td></tr>
    `).join('') || '<tr><td colspan="5">የጸደቁ ተማሪዎች የሉም</td></tr>';

    let notifRows = notifications.map(n => `
        <li style="padding:5px 0; border-bottom:1px dashed #ccc;">🔔 <b>${n.message}</b> <small style="color:#666;">(${n.time})</small></li>
    `).join('') || '<li>ምንም ማሳወቂያ የለም</li>';

    res.send(`
    <!DOCTYPE html>
    <html lang="am">
    <head><meta charset="UTF-8"><title>Admin Dashboard</title>
    <style>body { font-family: sans-serif; background: #eef2f5; padding: 15px; font-size: 13px; } .card { background: white; padding: 15px; border-radius: 10px; margin-bottom: 20px; } table { width: 100%; border-collapse: collapse; margin-top:5px; } th, td { border: 1px solid #ddd; padding: 6px; text-align: center; } th { background: #34495e; color: white; }</style></head>
    <body>
        <h2>🔐 ADMIN CONTROL & NOTIFICATIONS DASHBOARD</h2>
        <div class="card" style="background:#fdf2f2; border:1px solid #c0392b;">
            <h3 style="color:#c0392b; margin-top:0;">🔔 የአድሚን ማሳወቂያዎች (Notifications)</h3>
            <ul style="margin:0; padding-left:20px; max-height:120px; overflow-y:auto;">${notifRows}</ul>
        </div>
        <div class="card"><h3>📥 አዲስ የተመዘገቡ ተማሪዎች (Pending Registration Approval)</h3>
        <table><thead><tr><th>ID</th><th>Password</th><th>Name</th><th>Class</th><th>Action</th></tr></thead><tbody>${pendingRows}</tbody></table></div>
        <div class="card"><h3>👨‍🏫 የመምህራን ዝርዝር (Manage & Edit Teachers)</h3>
        <table><thead><tr><th>ID</th><th>Pass</th><th>Name</th><th>Dept</th><th>Section</th><th>Action</th></tr></thead><tbody>${teacherRows}</tbody></table></div>
        <div class="card"><h3>🎓 የጸደቁ ተማሪዎች ዝርዝር (Manage & Edit Students)</h3>
        <table><thead><tr><th>ID</th><th>Pass</th><th>Name</th><th>Class</th><th>Action</th></tr></thead><tbody>${studentRows}</tbody></table></div>
        <a href="/logout" style="color:red; font-weight:bold; font-size:15px;">🔒 Logout</a>
    </body></html>
    `);
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
    <div style="font-family:sans-serif; padding:30px; max-width:400px; margin:auto;">
        <h2>✏️ መምህር ማስተካከል (Edit Teacher)</h2>
        <form action="/admin/update-teacher/${t.teacher_id}" method="POST">
            <label>ስም:</label><input type="text" name="name" value="${t.name}" style="width:100%; padding:8px; margin-bottom:10px;" required>
            <label>ፓስዎርድ:</label><input type="text" name="pass" value="${t.pass}" style="width:100%; padding:8px; margin-bottom:10px;" required>
            <label>የተመደበበት ሴክሽን:</label><input type="text" name="assigned_section" value="${t.assigned_section}" style="width:100%; padding:8px; margin-bottom:15px;" required>
            <button type="submit" style="background:green; color:white; padding:10px; width:100%; border:none; border-radius:6px; font-weight:bold;">💾 አስቀምጥ</button>
        </form>
    </div>`);
});

app.post('/admin/update-teacher/:id', async (req, res) => {
    if (!req.session.isAdminLoggedIn) return res.redirect('/');
    await Teacher.findOneAndUpdate({ teacher_id: req.params.id }, {
        name: req.body.name, pass: req.body.pass, assigned_section: req.body.assigned_section
    });
    res.redirect('/admin');
});

app.get('/admin/edit-student/:id', async (req, res) => {
    if (!req.session.isAdminLoggedIn) return res.redirect('/');
    let st = await Student.findOne({ student_id: req.params.id });
    if (!st) return res.redirect('/admin');
    res.send(`
    <div style="font-family:sans-serif; padding:30px; max-width:400px; margin:auto;">
        <h2>✏️ ተማሪ ማስተካከል (Edit Student)</h2>
        <form action="/admin/update-student/${st.student_id}" method="POST">
            <label>ሙሉ ስም:</label><input type="text" name="name" value="${st.name}" style="width:100%; padding:8px; margin-bottom:10px;" required>
            <label>ፓስዎርድ (PIN):</label><input type="text" name="password" value="${st.password}" style="width:100%; padding:8px; margin-bottom:10px;" required>
            <label>ሴክሽን:</label><input type="text" name="class_level" value="${st.class_level}" style="width:100%; padding:8px; margin-bottom:15px;" required>
            <button type="submit" style="background:green; color:white; padding:10px; width:100%; border:none; border-radius:6px; font-weight:bold;">💾 አስቀምጥ</button>
        </form>
    </div>`);
});

app.post('/admin/update-student/:id', async (req, res) => {
    if (!req.session.isAdminLoggedIn) return res.redirect('/');
    await Student.findOneAndUpdate({ student_id: req.params.id }, {
        name: req.body.name, password: req.body.password, class_level: req.body.class_level
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
    </div>
    <div style="text-align:center; margin-top:20px;"><a href="/logout" style="color:red; font-weight:bold;">🔒 Logout</a></div>
    </body></html>
    `);
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

    let courseRows = secCourses.map(c => `
        <tr><td>${c.course_name}</td><td>${c.teacher_name}</td><td>${c.day}</td><td>${c.time}</td><td>${c.room}</td></tr>
    `).join('') || '<tr><td colspan="5">ኮርስ የለም</td></tr>';

    res.send(`
    <!DOCTYPE html>
    <html lang="am">
    <head><meta charset="UTF-8"><title>Student Dashboard</title>
    <style>body { font-family: sans-serif; background: #f4f7f6; padding: 20px; } .container { max-width: 600px; margin: auto; background: white; padding: 20px; border-radius: 10px; }</style></head>
    <body><div class="container">
        <h2>🎓 የተማሪ ዳሽቦርድ</h2>
        <p>ስም: <b>${student.name}</b> | ሴክሽን: <b>${student.class_level}</b></p><hr>
        <h3>📥 የአስተማሪዎች Assessments</h3>${assessmentHtml}
        <br><a href="/logout" style="color:red; font-weight:bold;">🔒 Logout</a>
    </div></body></html>
    `);
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
