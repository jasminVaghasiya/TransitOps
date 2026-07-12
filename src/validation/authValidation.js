import Joi from 'joi';

// Signup validation schema
export const signupSchema = Joi.object({
  name: Joi.string()
    .trim()
    .min(2)
    .max(50)
    .required()
    .messages({
      'string.base': 'Name must be a text string',
      'string.empty': 'Name cannot be empty',
      'string.min': 'Name must be at least 2 characters long',
      'string.max': 'Name cannot exceed 50 characters',
      'any.required': 'Name is a required field',
    }),

  email: Joi.string()
    .trim()
    .email({ minDomainSegments: 2 })
    .lowercase()
    .required()
    .messages({
      'string.email': 'Please provide a valid email address',
      'string.empty': 'Email cannot be empty',
      'any.required': 'Email is a required field',
    }),

  password: Joi.string()
    .min(8)
    .max(30)
    .required()
    .messages({
      'string.empty': 'Password cannot be empty',
      'string.min': 'Password must be at least 8 characters long',
      'string.max': 'Password cannot exceed 30 characters',
      'any.required': 'Password is a required field',
    }),

  role: Joi.string()
    .valid('read_only', 'admin')
    .default('read_only')
    .messages({
      'any.only': 'Role must be either read_only or admin',
    }),
});

// Login validation schema
export const loginSchema = Joi.object({
  email: Joi.string()
    .trim()
    .email()
    .required()
    .messages({
      'string.email': 'Please provide a valid email address',
      'string.empty': 'Email cannot be empty',
      'any.required': 'Email is a required field',
    }),

  password: Joi.string()
    .required()
    .messages({
      'string.empty': 'Password cannot be empty',
      'any.required': 'Password is a required field',
    }),
});
