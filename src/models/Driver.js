import mongoose from 'mongoose';

const driverSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Driver name is required'],
      trim: true,
    },
    licenseNumber: {
      type: String,
      required: [true, 'License number is required'],
      unique: true,
      trim: true,
      uppercase: true,
    },
    licenseExpiry: {
      type: Date,
      required: [true, 'License expiry date is required'],
    },
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true,
      match: [/^\+?[1-9]\d{1,14}$/, 'Please fill a valid phone number (E.164 format)'],
    },
    status: {
      type: String,
      enum: ['Available', 'On Trip', 'Suspended', 'Off Duty', 'Fired', 'On Leave'],
      default: 'Available',
    },
    safetyScore: {
      type: Number,
      min: [0, 'Safety score cannot be below 0'],
      max: [100, 'Safety score cannot exceed 100'],
      default: 100,
    },
    licenseCategory: {
      type: String,
      enum: ['LMV', 'HMV'],
      default: 'LMV',
    },
    tripCompletionRate: {
      type: Number,
      min: [0, 'Trip completion rate cannot be below 0'],
      max: [100, 'Trip completion rate cannot exceed 100'],
      default: 100,
    },
    leaveUntil: {
      type: Date,
    },
    leaveStart: {
      type: Date,
    },
    leaveDays: {
      type: Number,
    },
    leaveReason: {
      type: String,
    },
    photo: {
      type: String,
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

// Virtual to check if license is expired
driverSchema.virtual('isLicenseExpired').get(function () {
  return this.licenseExpiry && this.licenseExpiry < new Date();
});

// Query middleware to exclude soft deleted drivers
driverSchema.pre(/^find/, function (next) {
  this.where({ isDeleted: { $ne: true } });
  next();
});

driverSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

const Driver = mongoose.model('Driver', driverSchema);
export default Driver;
