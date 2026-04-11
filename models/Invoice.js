const mongoose = require('mongoose');

const invoiceSchema = new mongoose.Schema({
  invoiceNumber: { type: String, unique: true, required: true },
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: {
    type: String,
    enum: ['invoice', 'receipt', 'credit_note'],
    default: 'invoice'
  },
  status: {
    type: String,
    enum: ['draft', 'sent', 'viewed', 'paid', 'overdue', 'cancelled'],
    default: 'draft'
  },
  lineItems: [{
    description: { type: String, required: true },
    service: String,
    quantity: { type: Number, default: 1 },
    unitPrice: { type: Number, required: true },
    total: { type: Number, required: true }
  }],
  subtotal: { type: Number, required: true },
  taxRate: { type: Number, default: 18 },
  taxAmount: { type: Number, default: 0 },
  discount: { type: Number, default: 0 },
  total: { type: Number, required: true },
  currency: { type: String, default: 'INR' },
  issueDate: { type: Date, default: Date.now },
  dueDate: { type: Date, required: true },
  paidDate: { type: Date },
  paidAmount: { type: Number, default: 0 },
  paymentMethod: { type: String, default: '' },
  paymentReference: { type: String, default: '' },
  notes: { type: String, default: '' },
  isRecurring: { type: Boolean, default: false },
  recurringInterval: { type: String, enum: ['monthly', 'quarterly', 'yearly'], default: 'monthly' }
}, { timestamps: true });

invoiceSchema.index({ clientId: 1, status: 1 });
invoiceSchema.index({ dueDate: 1, status: 1 });
invoiceSchema.index({ issueDate: 1 });

// Auto-generate invoice number
invoiceSchema.pre('validate', async function (next) {
  if (!this.invoiceNumber) {
    const count = await mongoose.model('Invoice').countDocuments();
    this.invoiceNumber = `ADS-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`;
  }
  next();
});

module.exports = mongoose.model('Invoice', invoiceSchema);
