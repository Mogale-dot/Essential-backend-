const { z } = require('zod');

/**
 * Validates salon + owner signup input
 */
exports.registerSalonSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  confirmPassword: z.string().min(8),
  ownerName: z.string().min(2),
  salonName: z.string().min(2),
  categories: z.array(z.string()).min(1)
}).refine(data => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword']
});
 
