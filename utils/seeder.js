require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const User = require('../models/User');
const Department = require('../models/Department');
const Client = require('../models/Client');
const Project = require('../models/Project');
const Task = require('../models/Task');
const Invoice = require('../models/Invoice');
const { Conversation } = require('../models/Chat');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/aidamsole';

const seed = async () => {
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected to MongoDB');

  // Clear existing data
  await Promise.all([
    User.deleteMany({}), Department.deleteMany({}),
    Client.deleteMany({}), Project.deleteMany({}),
    Task.deleteMany({}), Invoice.deleteMany({})
  ]);
  console.log('🗑️  Cleared existing data');

  // ── DEPARTMENTS ─────────────────────────────────────────────────────────────
  const deptData = [
    { name: 'SEO', slug: 'seo', color: '#10B981', icon: 'search' },
    { name: 'Paid Ads', slug: 'paid_ads', color: '#3B82F6', icon: 'trending-up' },
    { name: 'Social Media', slug: 'social_media', color: '#8B5CF6', icon: 'instagram' },
    { name: 'Web Dev', slug: 'web_dev', color: '#F59E0B', icon: 'code' },
    { name: 'Sales', slug: 'sales', color: '#EF4444', icon: 'dollar-sign' },
    { name: 'Accounts', slug: 'accounts', color: '#6B7280', icon: 'file-text' }
  ];
  const departments = await Department.insertMany(deptData);
  console.log('✅ Departments created');

  const deptMap = {};
  departments.forEach(d => { deptMap[d.slug] = d._id; });

  // ── USERS ───────────────────────────────────────────────────────────────────
  const hashedPwd = await bcrypt.hash('admin123', 12);

  const usersData = [
    {
      name: 'Rohan Sharma', email: 'admin@aidamsole.com', password: hashedPwd,
      role: 'super_admin', departmentRole: 'Founder & Super Admin'
    },
    {
      name: 'Priya Patel', email: 'seo.manager@aidamsole.com', password: hashedPwd,
      role: 'department_manager', departmentId: deptMap['seo'], departmentRole: 'SEO Manager'
    },
    {
      name: 'Vikram Singh', email: 'ads.manager@aidamsole.com', password: hashedPwd,
      role: 'department_manager', departmentId: deptMap['paid_ads'], departmentRole: 'Paid Ads Manager'
    },
    {
      name: 'Anjali Mehta', email: 'social.manager@aidamsole.com', password: hashedPwd,
      role: 'department_manager', departmentId: deptMap['social_media'], departmentRole: 'Social Media Manager'
    },
    {
      name: 'Dev Kapoor', email: 'webdev.manager@aidamsole.com', password: hashedPwd,
      role: 'department_manager', departmentId: deptMap['web_dev'], departmentRole: 'Web Dev Lead'
    },
    {
      name: 'Sneha Rajan', email: 'am1@aidamsole.com', password: hashedPwd,
      role: 'employee', departmentId: deptMap['seo'], departmentRole: 'Account Manager'
    },
    {
      name: 'Arjun Nair', email: 'am2@aidamsole.com', password: hashedPwd,
      role: 'employee', departmentId: deptMap['paid_ads'], departmentRole: 'Ads Strategist'
    },
    {
      name: 'Kavya Reddy', email: 'content@aidamsole.com', password: hashedPwd,
      role: 'employee', departmentId: deptMap['social_media'], departmentRole: 'Content Creator'
    },
    {
      name: 'Rahul Gupta', email: 'seo.exec@aidamsole.com', password: hashedPwd,
      role: 'employee', departmentId: deptMap['seo'], departmentRole: 'SEO Executive'
    },
    {
      name: 'Meena Iyer', email: 'accounts@aidamsole.com', password: hashedPwd,
      role: 'department_manager', departmentId: deptMap['accounts'], departmentRole: 'Accounts Manager'
    }
  ];

  const users = await User.insertMany(usersData);
  console.log('✅ Users created');

  const superAdmin = users[0];
  const seoManager = users[1];
  const adsManager = users[2];
  const socialManager = users[3];
  const am1 = users[5];
  const am2 = users[6];

  // Update dept heads and members
  await Department.findByIdAndUpdate(deptMap['seo'], {
    headIds: [seoManager._id],
    headId: seoManager._id,
    members: [seoManager._id, am1._id, users[8]._id]
  });
  await Department.findByIdAndUpdate(deptMap['paid_ads'], {
    headIds: [adsManager._id],
    headId: adsManager._id,
    members: [adsManager._id, am2._id]
  });
  await Department.findByIdAndUpdate(deptMap['social_media'], {
    headIds: [socialManager._id],
    headId: socialManager._id,
    members: [socialManager._id, users[7]._id]
  });
  await Department.findByIdAndUpdate(deptMap['web_dev'], {
    headIds: [users[4]._id],
    headId: users[4]._id,
    members: [users[4]._id]
  });
  await Department.findByIdAndUpdate(deptMap['accounts'], {
    headIds: [users[9]._id],
    headId: users[9]._id,
    members: [users[9]._id]
  });

  // ── CLIENTS ─────────────────────────────────────────────────────────────────
  const clientsData = [
    {
      name: 'Rajesh Khurana', company: 'TechVista India', email: 'rajesh@techvista.in',
      phone: 9876543210, website: 'https://techvista.in', industry: 'Technology',
      assignedAM: am1._id, assignedDepartments: [deptMap['seo'], deptMap['paid_ads']],
      services: ['SEO', 'Paid Ads'], status: 'active', contractValue: 45000,
      healthScore: { overall: 9, engagement: 9, results: 9, payment: 10, sentiment: 8 },
      contractStart: new Date('2024-01-01'), contractEnd: new Date('2024-12-31'),
      renewalDate: new Date('2024-12-01'), onboardingCompleted: true
    },
    {
      name: 'Sunita Sharma', company: 'Fashion Forward', email: 'sunita@fashionforward.com',
      phone: 9876543211, website: 'https://fashionforward.com', industry: 'Fashion',
      assignedAM: am2._id, assignedDepartments: [deptMap['social_media'], deptMap['paid_ads']],
      services: ['Social Media', 'Paid Ads'], status: 'active', contractValue: 35000,
      healthScore: { overall: 7, engagement: 7, results: 6, payment: 9, sentiment: 6 },
      contractStart: new Date('2024-02-01'), contractEnd: new Date('2024-12-31'),
      renewalDate: new Date('2024-12-15'), onboardingCompleted: true
    },
    {
      name: 'Amit Joshi', company: 'GreenEarth NGO', email: 'amit@greenearth.org',
      phone: 9876543212, industry: 'Non-profit',
      assignedAM: am1._id, assignedDepartments: [deptMap['seo']],
      services: ['SEO'], status: 'at_risk', contractValue: 15000,
      healthScore: { overall: 3, engagement: 3, results: 2, payment: 4, sentiment: 3 },
      contractStart: new Date('2024-03-01'), onboardingCompleted: true
    },
    {
      name: 'Pooja Verma', company: 'Real Estate Kings', email: 'pooja@rekings.in',
      phone: 9876543213, industry: 'Real Estate',
      assignedAM: am2._id, assignedDepartments: [deptMap['paid_ads'], deptMap['web_dev']],
      services: ['Paid Ads', 'Web Dev'], status: 'active', contractValue: 65000,
      healthScore: { overall: 8, engagement: 8, results: 8, payment: 9, sentiment: 7 },
      contractStart: new Date('2024-01-15'), renewalDate: new Date('2025-01-15'),
      onboardingCompleted: true
    },
    {
      name: 'Kiran Desai', company: 'HealthFirst Clinic', email: 'kiran@healthfirst.in',
      phone: 9876543214, industry: 'Healthcare',
      assignedAM: am1._id, assignedDepartments: [deptMap['seo'], deptMap['social_media']],
      services: ['SEO', 'Social Media'], status: 'active', contractValue: 28000,
      healthScore: { overall: 6, engagement: 6, results: 5, payment: 8, sentiment: 5 },
      contractStart: new Date('2024-04-01'), onboardingCompleted: false
    }
  ];

  const clients = await Client.insertMany(clientsData);
  console.log('✅ Clients created');

  // ── PROJECTS ────────────────────────────────────────────────────────────────
  const projectsData = [
    {
      title: 'TechVista SEO Campaign Q4 2024', clientId: clients[0]._id,
      departmentId: deptMap['seo'], managerId: seoManager._id,
      team: [seoManager._id, am1._id, users[8]._id],
      service: ['SEO'], status: 'active', priority: 'high',
      startDate: new Date('2024-10-01'), dueDate: new Date('2024-12-31'),
      budget: 45000, spent: 28000, progress: 65,
      kpis: [
        { metric: 'Keyword Rankings (Top 10)', target: 50, current: 32, unit: 'keywords' },
        { metric: 'Organic Traffic Growth', target: 40, current: 25, unit: '%' },
        { metric: 'Domain Authority', target: 45, current: 38, unit: 'DA' }
      ]
    },
    {
      title: 'Fashion Forward Meta Ads', clientId: clients[1]._id,
      departmentId: deptMap['paid_ads'], managerId: adsManager._id,
      team: [adsManager._id, am2._id],
      service: ['Paid Ads'], status: 'active', priority: 'high',
      startDate: new Date('2024-09-01'), dueDate: new Date('2024-12-31'),
      budget: 120000, spent: 78000, progress: 55,
      kpis: [
        { metric: 'ROAS', target: 4, current: 3.2, unit: 'x' },
        { metric: 'CPL', target: 150, current: 188, unit: '₹' },
        { metric: 'Monthly Leads', target: 200, current: 156, unit: 'leads' }
      ]
    },
    {
      title: 'Real Estate Kings PPC + Web Revamp', clientId: clients[3]._id,
      departmentId: deptMap['web_dev'], managerId: users[4]._id,
      team: [users[4]._id, am2._id],
      service: ['Web Dev', 'Paid Ads'], status: 'active', priority: 'critical',
      startDate: new Date('2024-10-15'), dueDate: new Date('2024-12-15'),
      budget: 85000, spent: 42000, progress: 40
    },
    {
      title: 'GreenEarth SEO Recovery', clientId: clients[2]._id,
      departmentId: deptMap['seo'], managerId: seoManager._id,
      team: [seoManager._id, users[8]._id],
      service: ['SEO'], status: 'on_hold', priority: 'medium',
      startDate: new Date('2024-08-01'), dueDate: new Date('2024-11-30'),
      budget: 20000, spent: 12000, progress: 30
    }
  ];

  const projects = await Project.insertMany(projectsData);
  console.log('✅ Projects created');

  // ── TASKS ───────────────────────────────────────────────────────────────────
  const now = new Date();
  const tasksData = [
    {
      title: 'Complete Q4 keyword research & clustering',
      projectId: projects[0]._id, clientId: clients[0]._id,
      departmentId: deptMap['seo'], assigneeId: users[8]._id,
      reviewerId: seoManager._id, reviewerIds: [seoManager._id], createdBy: seoManager._id,
      status: 'in_progress', priority: 'high',
      dueDate: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
      estimatedHours: 8, actualHours: 5,
      subtasks: [
        { title: 'Export current rankings from GSC', completed: true },
        { title: 'Competitor keyword gap analysis', completed: true },
        { title: 'Cluster keywords by intent', completed: false },
        { title: 'Create content brief for top 10 KWs', completed: false }
      ]
    },
    {
      title: 'Write 4 optimized blog posts (October)',
      projectId: projects[0]._id, clientId: clients[0]._id,
      departmentId: deptMap['seo'], assigneeId: am1._id,
      createdBy: seoManager._id, reviewerId: seoManager._id, reviewerIds: [seoManager._id],
      status: 'review', priority: 'high',
      dueDate: new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000),
      estimatedHours: 12, actualHours: 10
    },
    {
      title: 'Build Oct-Dec backlink strategy',
      projectId: projects[0]._id, clientId: clients[0]._id,
      departmentId: deptMap['seo'], assigneeId: users[8]._id,
      createdBy: seoManager._id,
      status: 'todo', priority: 'medium',
      dueDate: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      estimatedHours: 6
    },
    {
      title: 'Fashion Forward: Create 5 new ad creatives',
      projectId: projects[1]._id, clientId: clients[1]._id,
      departmentId: deptMap['paid_ads'], assigneeId: am2._id,
      reviewerId: adsManager._id, reviewerIds: [adsManager._id], createdBy: adsManager._id,
      status: 'in_progress', priority: 'critical',
      dueDate: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000), // overdue
      isDelayed: true, estimatedHours: 6, actualHours: 8
    },
    {
      title: 'Weekly Meta Ads optimization — Week 42',
      projectId: projects[1]._id, clientId: clients[1]._id,
      departmentId: deptMap['paid_ads'], assigneeId: adsManager._id,
      createdBy: adsManager._id,
      status: 'done', priority: 'high',
      dueDate: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
      estimatedHours: 3, actualHours: 2.5,
      twoEyeApproved: true, twoEyeApprovedBy: superAdmin._id
    },
    {
      title: 'Redesign homepage hero section',
      projectId: projects[2]._id, clientId: clients[3]._id,
      departmentId: deptMap['web_dev'], assigneeId: users[4]._id,
      createdBy: users[4]._id,
      status: 'in_progress', priority: 'critical',
      dueDate: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000),
      estimatedHours: 16, actualHours: 8
    },
    {
      title: 'GreenEarth: Technical SEO audit report',
      projectId: projects[3]._id, clientId: clients[2]._id,
      departmentId: deptMap['seo'], assigneeId: users[8]._id,
      reviewerId: seoManager._id, reviewerIds: [seoManager._id], createdBy: seoManager._id,
      status: 'blocked', priority: 'medium',
      dueDate: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
      isDelayed: true, estimatedHours: 10, actualHours: 3
    }
  ];

  await Task.insertMany(tasksData);
  console.log('✅ Tasks created');

  // ── INVOICES ─────────────────────────────────────────────────────────────────
  const invoicesData = [
    {
      invoiceNumber: 'ADS-2024-0001', clientId: clients[0]._id, createdBy: superAdmin._id,
      projectId: projects[0]._id, status: 'paid',
      lineItems: [
        { description: 'SEO Services — October 2024', service: 'SEO', quantity: 1, unitPrice: 45000, total: 45000 }
      ],
      subtotal: 45000, taxRate: 18, taxAmount: 8100, total: 53100,
      issueDate: new Date('2024-10-01'), dueDate: new Date('2024-10-15'),
      paidDate: new Date('2024-10-12'), paidAmount: 53100, paymentMethod: 'Bank Transfer'
    },
    {
      invoiceNumber: 'ADS-2024-0002', clientId: clients[1]._id, createdBy: superAdmin._id,
      projectId: projects[1]._id, status: 'paid',
      lineItems: [
        { description: 'Meta Ads Management — October 2024', service: 'Paid Ads', quantity: 1, unitPrice: 35000, total: 35000 },
        { description: 'Ad Spend Management Fee', service: 'Paid Ads', quantity: 1, unitPrice: 8000, total: 8000 }
      ],
      subtotal: 43000, taxRate: 18, taxAmount: 7740, total: 50740,
      issueDate: new Date('2024-10-01'), dueDate: new Date('2024-10-15'),
      paidDate: new Date('2024-10-10'), paidAmount: 50740, paymentMethod: 'UPI'
    },
    {
      invoiceNumber: 'ADS-2024-0003', clientId: clients[3]._id, createdBy: superAdmin._id,
      status: 'sent',
      lineItems: [
        { description: 'PPC Management — November 2024', service: 'Paid Ads', quantity: 1, unitPrice: 40000, total: 40000 },
        { description: 'Web Development — Phase 1', service: 'Web Dev', quantity: 1, unitPrice: 25000, total: 25000 }
      ],
      subtotal: 65000, taxRate: 18, taxAmount: 11700, total: 76700,
      issueDate: new Date('2024-11-01'), dueDate: new Date('2024-11-15')
    },
    {
      invoiceNumber: 'ADS-2024-0004', clientId: clients[2]._id, createdBy: superAdmin._id,
      status: 'overdue',
      lineItems: [
        { description: 'SEO Services — September 2024', service: 'SEO', quantity: 1, unitPrice: 15000, total: 15000 }
      ],
      subtotal: 15000, taxRate: 18, taxAmount: 2700, total: 17700,
      issueDate: new Date('2024-09-01'), dueDate: new Date('2024-09-15')
    },
    {
      invoiceNumber: 'ADS-2024-0005', clientId: clients[4]._id, createdBy: superAdmin._id,
      status: 'paid',
      lineItems: [
        { description: 'SEO + Social Media — October 2024', service: 'SEO', quantity: 1, unitPrice: 28000, total: 28000 }
      ],
      subtotal: 28000, taxRate: 18, taxAmount: 5040, total: 33040,
      issueDate: new Date('2024-10-01'), dueDate: new Date('2024-10-20'),
      paidDate: new Date('2024-10-18'), paidAmount: 33040
    }
  ];

  await Invoice.insertMany(invoicesData);
  console.log('✅ Invoices created');

  // ── CONVERSATIONS ────────────────────────────────────────────────────────────
  await Conversation.create({
    type: 'group', name: 'AiDamsole Team — General',
    participants: users.map(u => u._id),
    lastMessage: { text: 'Good morning team! Standup in 15 mins', senderId: superAdmin._id, timestamp: new Date() }
  });
  await Conversation.create({
    type: 'group', name: 'SEO Department',
    participants: [seoManager._id, am1._id, users[8]._id],
    lastMessage: { text: 'Keyword research sheet is ready for review', senderId: users[8]._id, timestamp: new Date() }
  });
  console.log('✅ Conversations created');

  console.log('\n🎉 SEED COMPLETE!\n');
  console.log('─────────────────────────────────────────');
  console.log('🔐 LOGIN CREDENTIALS');
  console.log('─────────────────────────────────────────');
  console.log('Super Admin:       admin@aidamsole.com       / admin123');
  console.log('SEO Manager:       seo.manager@aidamsole.com / admin123');
  console.log('Ads Manager:       ads.manager@aidamsole.com / admin123');
  console.log('Social Manager:    social.manager@aidamsole.com / admin123');
  console.log('Account Manager 1: am1@aidamsole.com          / admin123');
  console.log('Account Manager 2: am2@aidamsole.com          / admin123');
  console.log('─────────────────────────────────────────\n');

  process.exit(0);
};

seed().catch(err => {
  console.error('❌ Seeder error:', err);
  process.exit(1);
});
