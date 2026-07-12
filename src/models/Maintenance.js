import mongoose from 'mongoose';

const maintenanceSchema = new mongoose.Schema(
  {
    vehicle: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vehicle',
      required: [true, 'Vehicle is required for maintenance record'],
    },
    description: {
      type: String,
      required: [true, 'Maintenance description is required'],
      trim: true,
    },
    cost: {
      type: Number,
      required: [true, 'Maintenance cost is required'],
      min: [0, 'Maintenance cost cannot be negative'],
    },
    status: {
      type: String,
      enum: ['Active', 'Closed', 'Completed', 'Cancelled'],
      default: 'Active',
    },
    startDate: {
      type: Date,
      default: Date.now,
    },
    endDate: {
      type: Date,
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

// Query middleware to exclude soft deleted maintenance records
maintenanceSchema.pre(/^find/, function (next) {
  this.where({ isDeleted: { $ne: true } });
  next();
});

const Maintenance = mongoose.model('Maintenance', maintenanceSchema);
export default Maintenance;
