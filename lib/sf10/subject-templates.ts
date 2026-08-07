/**
 * Standard subject lists used when a new term is created, so the registrar starts from the
 * curriculum rather than an empty grid.
 *
 * JHS learning areas are fixed and come from the SF10 template itself (see jhs-map.ts).
 * SHS lists vary by strand; these are the school's common Academic-track sequences and are
 * meant to be edited per learner, which is why the template drives them from a dropdown.
 */

import type { ShsCategory } from "./shs-map.ts";

export interface SubjectTemplate {
  name: string;
  category: ShsCategory;
}

export const SHS_SUBJECT_TEMPLATES: Record<string, SubjectTemplate[]> = {
  "11-1": [
    { name: "Oral Communication", category: "Core" },
    { name: "Komunikasyon at Pananaliksik sa Wika at Kulturang Pilipino", category: "Core" },
    { name: "Media and Information Literacy", category: "Core" },
    { name: "General Mathematics", category: "Core" },
    { name: "Earth and Life Science", category: "Core" },
    { name: "Personal Development/Pansariling Kaunlaran", category: "Core" },
    { name: "Understanding Culture, Society and Politics", category: "Core" },
    { name: "Physical Education and Health", category: "Core" },
    { name: "Organization and Management", category: "Specialized" },
    { name: "Homeroom Guidance", category: "Other_Subjects" },
  ],
  "11-2": [
    { name: "Reading and Writing", category: "Core" },
    { name: "Pagbasa at Pagsusuri ng Iba't Ibang Teksto Tungo sa Pananaliksik", category: "Core" },
    { name: "21st Century Literature from the Philippines and the World", category: "Core" },
    { name: "Contemporary Philippine Arts from the Regions", category: "Core" },
    { name: "Statistics and Probability", category: "Core" },
    { name: "Physical Science", category: "Core" },
    {
      name: "Introduction to the Philosophy of the Human Person/Pambungad sa Pilosopiya ng Tao",
      category: "Core",
    },
    { name: "Physical Education and Health", category: "Core" },
    { name: "Trend, Networks, and Critical Thinking in the 21st Century", category: "Specialized" },
    { name: "Homeroom Guidance", category: "Other_Subjects" },
  ],
  "12-1": [
    { name: "English for Academic and Professional Purposes", category: "Applied" },
    { name: "Practical Research 1", category: "Applied" },
    { name: "Filipino sa Piling Larang", category: "Applied" },
    { name: "Empowerment Technologies", category: "Applied" },
    { name: "Disaster Readiness and Risk Reduction", category: "Core" },
    { name: "Physical Education and Health", category: "Core" },
    { name: "Business Finance", category: "Specialized" },
    { name: "Homeroom Guidance", category: "Other_Subjects" },
  ],
  "12-2": [
    { name: "Practical Research 2", category: "Applied" },
    { name: "Entrepreneurship", category: "Applied" },
    { name: "Inquiries, Investigations and Immersion", category: "Applied" },
    { name: "Contemporary Philippine Arts from the Regions", category: "Core" },
    { name: "Physical Education and Health", category: "Core" },
    { name: "Food and Beverage Services NC II", category: "Specialized" },
    { name: "Homeroom Guidance", category: "Other_Subjects" },
  ],
};

export const SHS_TRACKS = [
  "ACADEMIC TRACK/ ACCOUNTANCY, BUSINESS AND MANAGEMENT STRAND",
  "ACADEMIC TRACK/ GENERAL ACADEMIC STRAND",
  "ACADEMIC TRACK/ SCIENCE, TECHNOLOGY, ENGINEERING AND MATHEMATICS STRAND",
  "ACADEMIC TRACK/ HUMANITIES AND SOCIAL SCIENCES STRAND",
  "TVL TRACK/ HOME ECONOMICS",
] as const;

export function shsSubjectsFor(level: 11 | 12, semester: 1 | 2): SubjectTemplate[] {
  return SHS_SUBJECT_TEMPLATES[`${level}-${semester}`] ?? [];
}
