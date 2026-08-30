import { z } from "zod";

// Zod schemas for validating input. As the app grows (Phase 1: the order
// intake body, presign requests, etc.) their schemas live here too, so every
// request body is validated in one predictable place.

export const loginSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

export type LoginInput = z.infer<typeof loginSchema>;
