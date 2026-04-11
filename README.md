# AiDamsole CRM — Backend API

Production-ready Node.js/Express backend for AiDamsole Digital Marketing Agency CRM.

## Tech Stack

- **Runtime**: Node.js v18+
- **Framework**: Express.js
- **Database**: MongoDB + Mongoose
- **Auth**: JWT (7-day expiry)
- **Real-time**: Socket.io
- **File Upload**: Multer
- **Scheduled Jobs**: node-cron
- **Email**: Nodemailer

---

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Environment setup

```bash
cp .env.example .env
# Edit .env with your MongoDB URI, JWT secret, SMTP credentials
```

### 3. Seed database (demo data + login credentials)

```bash
npm run seed
```

### 4. Start server

```bash
# Development
npm run dev

# Production
npm start
```

Server runs on **http://localhost:5000**

---

## Login Credentials (after seeding)

| Role | Email | Password |
|------|-------|----------|
| Super Admin | admin@aidamsole.com | admin123 |
| SEO Manager | seo.manager@aidamsole.com | admin123 |
| Ads Manager | ads.manager@aidamsole.com | admin123 |
| Social Manager | social.manager@aidamsole.com | admin123 |
| Account Manager 1 | am1@aidamsole.com | admin123 |
| Account Manager 2 | am2@aidamsole.com | admin123 |

---

## API Reference

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | Login with email + password |
| GET | `/api/auth/me` | Get current user |
| PUT | `/api/auth/update-password` | Change password |
| PUT | `/api/auth/update-profile` | Update profile |

### Users (Admin only)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/users` | List users (dept-scoped) |
| POST | `/api/users` | Create user |
| GET | `/api/users/:id` | Get user |
| PUT | `/api/users/:id` | Update user |
| DELETE | `/api/users/:id` | Deactivate user |

### Departments
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/departments` | List all departments |
| POST | `/api/departments` | Create department |
| GET | `/api/departments/:id` | Get department |
| PUT | `/api/departments/:id` | Update department |
| POST | `/api/departments/:id/members` | Add member |
| DELETE | `/api/departments/:id/members/:userId` | Remove member |
| GET | `/api/departments/:id/stats` | Department stats |

### Clients
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/clients` | List clients (RBAC-scoped) |
| POST | `/api/clients` | Create client |
| GET | `/api/clients/:id` | Get client + stats |
| PUT | `/api/clients/:id` | Update client |
| PUT | `/api/clients/:id/health-score` | Update health score |
| GET | `/api/clients/:id/timeline` | Client activity timeline |

### Projects
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects` | List projects |
| POST | `/api/projects` | Create project |
| GET | `/api/projects/:id` | Get project |
| PUT | `/api/projects/:id` | Update project |
| GET | `/api/projects/:id/tasks` | Project tasks |

### Tasks
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/tasks` | List tasks |
| POST | `/api/tasks` | Create task |
| GET | `/api/tasks/:id` | Get task |
| PUT | `/api/tasks/:id` | Update task |
| PUT | `/api/tasks/:id/two-eye-approve` | Two-eye approval (SOP) |
| POST | `/api/tasks/:id/comments` | Add comment |
| POST | `/api/tasks/:id/time-log` | Log time |
| PUT | `/api/tasks/:id/subtask/:subtaskId` | Update subtask |

### Finance
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/finance/summary` | Financial KPIs (admin) |
| GET | `/api/finance/invoices` | List invoices |
| POST | `/api/finance/invoices` | Create invoice |
| GET | `/api/finance/invoices/:id` | Get invoice |
| PUT | `/api/finance/invoices/:id` | Update invoice |
| POST | `/api/finance/invoices/:id/payment` | Record payment |
| GET | `/api/finance/revenue-chart` | Revenue chart data |

### Reports (Advanced)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/reports/financial` | Financial report (admin) |
| GET | `/api/reports/client-performance` | Client performance report |
| GET | `/api/reports/team-performance` | Team performance report |
| GET | `/api/reports/operational` | Operational report |
| GET | `/api/reports/super-admin-insights` | KPI insights (admin) |
| POST | `/api/reports/share` | Generate share link |
| GET | `/api/reports/shared/:token` | View shared report |

**Query params for reports**: `range=daily|weekly|monthly|yearly`, `startDate`, `endDate`, `department`, `clientId`, `userId`

### Dashboard
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/dashboard` | Role-aware dashboard data |
| GET | `/api/dashboard/health-scores` | All client health scores |
| GET | `/api/dashboard/standup` | Daily standup data |

### Chat
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/chat/users` | List chattable users |
| GET | `/api/chat/conversations` | List conversations |
| POST | `/api/chat/conversations` | Create conversation |
| GET | `/api/chat/conversations/:id/messages` | Get messages |
| POST | `/api/chat/conversations/:id/messages` | Send message |

### Notifications
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/notifications` | Get notifications |
| PUT | `/api/notifications/mark-all-read` | Mark all read |
| PUT | `/api/notifications/:id/read` | Mark one read |

### File Upload
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/upload/single` | Upload single file |
| POST | `/api/upload/multiple` | Upload multiple files |

---

## RBAC (Role-Based Access Control)

| Role | Access |
|------|--------|
| `super_admin` | Full system access, all departments, all reports, all financials |
| `admin` | Same as super_admin |
| `department_manager` | Own department data only — clients, projects, tasks, team |
| `employee` | Assigned tasks/projects only |

---

## Socket.io Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `user:join` | Client → Server | Register user presence |
| `users:online` | Server → All | Online user list |
| `chat:join` | Client → Server | Join conversation room |
| `chat:message` | Both | Send/receive message |
| `chat:typing` | Client → Room | Typing indicator |
| `task:update` | Client → Server | Task status update |
| `task:updated` | Server → All | Broadcast task update |
| `notification:new` | Server → User | Push notification |

---

## Cron Jobs

| Schedule | Job |
|----------|-----|
| Every hour | Flag overdue tasks |
| Every hour (30 min) | Flag overdue invoices |
| Friday 4:30 PM | Weekly health score alerts |
| Daily 9:00 AM | Renewal reminders (30/14/7/3/1 days) |
| Monday 8:30 AM | Weekly standup notification |

---

## Project Structure

```
backend/
├── config/
│   └── database.js
├── controllers/
│   ├── authController.js
│   ├── userController.js
│   ├── departmentController.js
│   ├── clientController.js
│   ├── projectController.js
│   ├── taskController.js
│   ├── financeController.js
│   ├── reportController.js
│   ├── dashboardController.js
│   ├── chatController.js
│   ├── notificationController.js
│   └── uploadController.js
├── middleware/
│   └── auth.js
├── models/
│   ├── User.js
│   ├── Department.js
│   ├── Client.js
│   ├── Project.js
│   ├── Task.js
│   ├── Invoice.js
│   ├── Chat.js
│   ├── Notification.js
│   └── Report.js
├── routes/
│   ├── auth.js
│   ├── users.js
│   ├── departments.js
│   ├── clients.js
│   ├── projects.js
│   ├── tasks.js
│   ├── finance.js
│   ├── reports.js
│   ├── chat.js
│   ├── notifications.js
│   ├── upload.js
│   └── dashboard.js
├── utils/
│   ├── cronJobs.js
│   ├── email.js
│   └── seeder.js
├── uploads/           # File storage
├── server.js          # Entry point
├── package.json
└── .env.example
```
