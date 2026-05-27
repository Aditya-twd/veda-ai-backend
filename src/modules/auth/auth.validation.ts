import { z } from "zod";

export const googleLoginSchema = z.object({
  body: z.object({
    credential: z.string().trim().min(1, "Google credential is required"),
  }),
});

export const updateProfileSchema = z.object({
  body: z.object({
    school: z.object({
      name: z.string().trim().min(1, "School name is required"),
      location: z.string().trim().optional().default(""),
      sector: z.string().trim().optional().default(""),
    }),
  }),
});

export type UpdateProfileBody = z.infer<typeof updateProfileSchema>["body"];
