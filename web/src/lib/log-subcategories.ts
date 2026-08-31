import { type LogCategory } from "./constants.generated";

export type LogSubcategory = string;

export const LOG_SUBCATEGORIES: Record<LogCategory, LogSubcategory[]> = {
  meal: ["breakfast", "lunch", "dinner", "snack", "milk", "formula"],
  sleep: ["morning_nap", "afternoon_nap", "night_sleep"],
  diaper: ["wet", "dirty", "both", "dry"],
  medication: ["vitamin_d", "iron", "multivitamin", "custom"],
  activity: ["outdoor_play", "indoor_play", "reading", "tv", "bath", "walk", "educational_toy", "drawing", "singing"],
  mood: ["happy", "calm", "fussy", "crying", "sleepy", "irritable"],
  health: ["sneezing", "coughing", "vomiting", "rash", "normal"],
  learning: [],
  therapy: [],
  note: [],
  other: [],
};
