import mongoose from 'mongoose';

const expenseSchema = new mongoose.Schema(
  {
    expenseType: {
      type: String,
      required: [true, 'Expense type is required'],
      trim: true,
    },
    amount: {
      type: Number,
      required: [true, 'Expense amount is required'],
      min: [0.01, 'Expense amount must be greater than zero'],
    },
    date: {
      type: Date,
      required: [true, 'Expense date is required'],
      validate: {
        validator: function (val) {
          return val <= new Date();
        },
        message: 'Expense date cannot be in the future',
      },
    },
    description: {
      type: String,
      trim: true,
    },
    vehicle: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vehicle',
    },
    trip: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Trip',
    },
    status: {
      type: String,
      enum: ['Pending', 'Approved', 'Rejected'],
      default: 'Pending',
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Query middleware to exclude soft deleted expenses
expenseSchema.pre(/^find/, function (next) {
  this.where({ isDeleted: { $ne: true } });
  next();
});

const Expense = mongoose.model('Expense', expenseSchema);
export default Expense;
