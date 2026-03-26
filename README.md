### ✨ Knowledge Team Dashboard: Task Management & Employee Analytics

![Vibe Coding](https://img.shields.io/badge/Vibe%20Coding-Project-purple?style=for-the-badge)
![Status](https://img.shields.io/badge/Status-Completed-success?style=for-the-badge)
![Tech](https://img.shields.io/badge/Built%20With-HTML%20%7C%20CSS%20%7C%20JS%20%7C%20Firebase-blue?style=for-the-badge)
![Integration](https://img.shields.io/badge/Integration-Python%20%7C%20ZKTeco-green?style=for-the-badge)

---

## 🚀 About the Project

The **Knowledge Team Dashboard** is a comprehensive **task management and employee analytics system** designed to streamline team workflows, track productivity, and manage attendance and leave records — all in one centralized platform.

This system is built for efficiency, featuring real-time data synchronization between a web-based dashboard and a Google Sheets backend, with automated attendance integration from biometric devices.

---

## 🖼️ Preview

### 📊 Admin Dashboard (Team Overview)
![Dashboard](./dashboard.png)

### 👤 Employee Performance Cards
![Employee](./employee.png)

---

## ⚡ Core Features

### 📋 Task Management & Delegation
- **Role-Based Access:** Admins and Team Leaders can assign and manage tasks.
- **Priority & Deadlines:** Set task urgency (Low/Medium/High) and track due dates.
- **Task History:** Full audit trail for every task, tracking status changes and reassignments.
- **Status Tracking:** Real-time updates for Pending, In Progress, Completed, and Overdue tasks.

### ⏱️ Automated Attendance System
- **Biometric Integration:** Attendance logs are fetched from ZKTeco devices via a Python sync script.
- **Google Sheets Backend:** All records are stored and calculated in Google Sheets for transparency.
- **Work Hour Analytics:** Automatic calculation of total daily and monthly work hours.

### 📊 Advanced Analytics & Reporting
- **Team Task Summary:** High-level overview of task distribution across different departments (Math, ICT, Physics, etc.).
- **Employee Dashboards:** Personalized views for employees to track their own tasks, attendance, and leave.
- **Excel Export:** Download task lists and leave history directly to `.xlsx` format for offline reporting.

### 🏖️ Leave Management
- **Quota Tracking:** Real-time balance for Annual, Casual, and Sick leaves.
- **History Logs:** Detailed records of approved leave dates and durations.

### 🔔 Notification System
- **Real-Time Alerts:** Notifications for new task assignments, task completions, and overdue warnings.
- **Admin Approval Center:** Centralized view for managing team requests.

---

## 🛠️ Tech Stack

### Frontend
- **HTML5 & CSS3:** Responsive UI with custom styling and consistent components.
- **Vanilla JavaScript:** Modular logic for data processing and DOM manipulation.
- **Firebase (Compat v8):** Authentication and Firestore for task and user management.
- **SheetJS (XLSX):** Client-side Excel generation.

### Backend & Integration
- **Google Sheets API:** Primary data source for attendance and leave records.
- **Python (Sync Script):** Integrated via `pyzk` and `pandas` to bridge biometric hardware with the cloud.

---

## 📂 Project Structure

```
📁 project/
 ├── index.html          # Main application entry point
 ├── css/
 │   └── style.css       # Core application styling
 ├── js/
 │   └── script.js       # Business logic and Firebase integration
 ├── zkteco_sync.py      # Attendance synchronization script (Python)
 ├── dashboard.png       # UI Screenshot
 ├── employee.png        # UI Screenshot
 └── README.md           # Project documentation
```

---

## ⚙️ Configuration & Setup

### 1. Web Application
- **Firebase:** Update `firebaseConfig` in `js/script.js` with your Project credentials.
- **Google Sheets:** Set your `SHEET_ID` and `SHEET_NAME` in `js/script.js`.

### 2. Biometric Sync (Python)
Ensure you have the following libraries installed:
```bash
pip install pyzk pandas google-auth google-api-python-client
```
Configure your ZKTeco device IP and Google API credentials within `zkteco_sync.py`.

---

## 🧠 Technical Highlights

- **Robust Data Parsing:** Uses a custom `parseTotalHours` utility to handle complex Google Sheets duration strings, preventing common year/hour misparsing issues.
- **Consistent UI State:** Implements a standard `.no-data` pattern across all task grids and lists for a polished user experience during empty states.
- **Optimized Performance:** Features an auto-refresh system (5-minute intervals) and real-time Firestore listeners for instant updates.

---

## 👨‍💻 Author

**A. K. M Shamimul Islam**

---

🚀 *“From idea → execution → full product.”*
