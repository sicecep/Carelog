# CareLog — Product Requirements Document (MVP to Production)

| **Field** | **Value** |
| --- | --- |
| **App** | CareLog |
| **Document Status** | Draft — v1.0 |
| **Product Manager** | Sepry (Product Manager) |
| **Platform** | Web App (MVP); PWA + Native Mobile (Phase 2) |
| **Last Updated** | June 26, 2026 |
| **Relevant Docs** | [Original PRD](./PRD%20-%20CareLog%20Daily%20Report%20App.md), [RFC Technical Architecture](./RFC%20-%20CareLog%20Technical%20Architecture.md) |

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [Vision & Goals](#3-vision--goals)
4. [User Personas](#4-user-personas)
5. [User Stories](#5-user-stories)
6. [Functional Requirements](#6-functional-requirements)
7. [Non-Functional Requirements](#7-non-functional-requirements)
8. [MVP Scope](#8-mvp-scope)
9. [Future Roadmap](#9-future-roadmap)
10. [Database Schema](#10-database-schema)
11. [API Design](#11-api-design)
12. [Mobile App Flows](#12-mobile-app-flows)
13. [Web Admin Flows](#13-web-admin-flows)
14. [Notifications Architecture](#14-notifications-architecture)
15. [Reporting Architecture](#15-reporting-architecture)
16. [Multi-Tenant SaaS Architecture](#16-multi-tenant-saas-architecture)
17. [Security Requirements](#17-security-requirements)
18. [Analytics & KPI Dashboard](#18-analytics--kpi-dashboard)
19. [Release Plan](#19-release-plan)
20. [Technical Architecture Diagram](#20-technical-architecture-diagram)
21. [Risks & Edge Cases](#21-risks--edge-cases)
22. [Acceptance Criteria Summary](#22-acceptance-criteria-summary)
23. [UX Design Notes](#23-ux-design-notes)
24. [SEO Requirements](#24-seo-requirements)
25. [Appendix: Auto-Review Summary](#25-appendix-auto-review-summary)

---

## 1. Executive Summary

### Product Overview

CareLog is a bilingual (Bahasa Indonesia / English) web application that replaces fragmented WhatsApp-based care communication with a structured, auditable daily care reporting platform. It serves households and small care arrangements in Indonesia where caregivers — nannies, domestic assistants (ART), elderly nurses, and family caregivers — are responsible for the daily wellbeing of a child, infant, elderly parent, or patient.

### The Core Problem

Indonesia has an estimated [DATA NEEDED] million households employing domestic caregivers. Care coordination today happens almost entirely over WhatsApp: photos of meals sent to a group chat, verbal updates during handoffs, and handwritten notes that are lost or forgotten. Parents and guardians have no reliable audit trail, no structured health record, and no way to identify patterns or risks in their dependent's care — until something goes wrong.

### The Solution

CareLog gives caregivers a simple, low-friction daily logging interface (three UX input modes optimized for varying digital literacy levels) and gives owners and guardians a structured, browsable view of care history. The platform is designed for Indonesia-first distribution — WhatsApp-based invitation, Bahasa Indonesia as the primary language, and a freemium pricing model anchored at Rp 49,000–79,000/month for the paid tier.

### Business Model Summary

| Tier | Monthly | Annual (save 17%) | Key Limits |
|---|---|---|---|
| Free | Rp 0 | — | 1 profile, 3 caregivers, 7-day history, daily reports, WhatsApp sharing |
| Starter | Rp 49,000/month | Rp 490,000/year | Up to 5 profiles, 10 caregivers, 90-day history, weekly summary, multi-viewer |
| Pro | Rp 79,000/month | Rp 790,000/year | Unlimited profiles & caregivers, full history, photo gallery, smart reminders, AI insights |

**Trial:** Every new account starts with a 14-day free Pro trial. No payment required. After trial, drops to Free tier if not upgraded.
**Payment:** Via Midtrans — QRIS, GoPay, OVO, DANA, ShopeePay, bank transfer (VA), Alfamart/Indomaret, credit/debit card.

### MVP Delivery Target

An 8–12 week MVP delivering P0 features: care profile creation, three-mode daily logging, parent report viewing, WhatsApp-based caregiver invitation, multi-caregiver assignment & revocation, magic link + Google OAuth, bilingual UI, daily email notifications, parent instruction notes, caregiver shift check-in/check-out, and incident reporting.

---

## 2. Problem Statement

### 2.1 Context

Caregiving in Indonesian households sits at the intersection of intimate trust and complete operational opacity. A parent leaves for work and has no visibility into what happens during the day. A caregiver logs nothing formally because no structured system exists. Communication defaults to WhatsApp — but WhatsApp was built for conversation, not for care records.

### 2.2 Core Pain Points

**For Owners / Guardians:**
- **No audit trail.** Care history exists only in WhatsApp chats — unsearchable, unstructured, and often deleted.
- **No accountability mechanism.** Owners cannot verify whether a caregiver followed instructions (dietary restrictions, medication schedules) without being physically present.
- **Fragmented health data.** Tracking a child's growth, an elderly parent's blood pressure, or medication adherence requires manual collation across notes, photos, and messages.
- **No incident visibility.** Minor incidents (a small fall, a fever spike, a refused meal) often go unreported because caregivers have no structured escalation channel.

**For Caregivers:**
- **Cognitive burden without structure.** Remembering to log eight categories of care with no system leads to omissions, especially for caregivers with lower digital literacy.
- **No record of their own work.** Caregivers have no log of their hours or tasks completed, creating disputes around accountability.
- **Fear of reporting problems.** Without a normalized incident reporting channel, caregivers under-report minor concerns that can compound into serious issues.

**For Care Recipients:**
- **Gaps in care continuity.** When a caregiver changes, the incoming caregiver has no structured handoff document — medical history, preferences, routines, and alerts are inaccessible.

### 2.3 Market Signals

| Signal | Data |
|---|---|
| Indonesian households with paid domestic caregivers | [DATA NEEDED] |
| Average household spend on childcare/eldercare (Jabodetabek) | [DATA NEEDED] |
| % of parents who feel "disconnected" from daytime care | [DATA NEEDED] |
| Estimated TAM (Indonesia caregiver coordination software) | [DATA NEEDED] |

### 2.4 Why Now

- **WhatsApp-native distribution** enables viral invite flows without a standalone messaging layer.
- **Indonesia's smartphone penetration** makes a web app viable for caregivers who previously required a native app.
- **Post-pandemic eldercare awareness** has elevated demand for structured remote monitoring tools.
- **No dominant incumbent** in the Indonesia B2C caregiver communication market at this price point.

---

## 3. Vision & Goals

### 3.1 Product Vision

> CareLog becomes the single source of truth for daily caregiving in Indonesian households — a platform where every meal logged, every medication tracked, and every incident reported creates a living care record that makes dependents safer and caregivers more trusted.

### 3.2 Strategic Goals

#### Business Goals (12 months post-launch)

| Goal | Target | Timeframe |
|---|---|---|
| Monthly Active Workspaces (MAW) | [DATA NEEDED] | Month 12 |
| Free-to-paid conversion rate | ≥ 8% | Month 6 |
| Monthly Recurring Revenue (MRR) | Rp 150,000,000 | Month 12 |
| Net Promoter Score (NPS) | ≥ 40 | Month 6 |

#### Product Goals (MVP)

| Goal | Target | Measurement |
|---|---|---|
| Time-to-first-log for new caregiver | < 5 minutes from invite link | Funnel analytics |
| Daily log completion rate | > 80% of active caregivers | Analytics |
| Parent report view within 24h | > 70% of submitted reports | Analytics |
| Incident notification delivery | < 60 seconds | Synthetic monitoring |

### 3.3 North Star Metric

**Weekly Active Care Logs (WACL)** — number of days in a week where at least one care log entry was submitted per active workspace.

---

## 4. User Personas

### 4.1 Persona 1 — Dewi, The Urban Working Mother

**Background:** Dewi, 34, is a marketing manager in Jakarta. She and her husband both work full-time and have a 2-year-old daughter and a 6-month-old son. They employ a live-in nanny (Bu Sari) and a part-time ART.

**Goals:** Know that children ate properly, took vitamins, and napped on schedule. Have structured health data to share with the pediatrician. Give the nanny clear daily instructions without a 20-message WhatsApp exchange.

**Frustrations:** Bu Sari sometimes forgets to send updates until Dewi asks. When she does, it's a wall of text in a group chat. When her daughter had a fever, the pediatrician asked for a temperature trend — Dewi had nothing structured to show.

**CareLog Use Case:** Primary owner. Creates profiles for both children. Invites Bu Sari as caregiver. Sets standing instructions. Views the daily report each evening. Shares the infant's health log with the pediatrician.

**Device:** iPhone 14 Pro, desktop Chrome at work.

---

### 4.2 Persona 2 — Bu Sari, The Live-In Nanny

**Background:** Bu Sari, 45, has been a live-in nanny in Jakarta for 12 years. She reads and writes Bahasa Indonesia. She uses a Samsung Galaxy A14 and is very comfortable with WhatsApp but has never used a productivity or reporting app.

**Goals:** Do her job well and have the parents see that she does it well. Not spend too much time on the phone when the babies need her. Avoid misunderstandings about task completion. Have a record if something unexpected happens.

**Frustrations:** Remembering to message about every small thing is stressful. She has been asked "why didn't you tell me?" when she forgot to mention that lunch wasn't finished. Anxious about apps she doesn't understand — if the first screen is confusing, she won't use it.

**CareLog Use Case:** Logs activities via Mode 1 (quick tap) throughout the day. Uses Mode 3 (quick summary) at day's end when she forgot to log in real time. Files an incident report when a child rolls off the play mat. Checks in and out of shifts. Views today's parent instructions each morning.

**Device:** Samsung Galaxy A14, mobile Chrome browser.

**Note:** Bu Sari represents the lowest common denominator for digital literacy. Every caregiver-facing screen must pass a "Bu Sari test": completable in 3 taps or fewer, Bahasa Indonesia text, no ambiguous icons.

---

### 4.3 Persona 3 — Pak Hendra, The Adult Son Managing Eldercare

**Background:** Pak Hendra, 52, is a semi-retired businessman in Surabaya. His mother (78) lives with him following a mild stroke 18 months ago. She requires daily monitoring — blood pressure, oxygen saturation, physiotherapy exercises, and medication at three intervals. He has hired a full-time nurse-caregiver and a part-time weekend caregiver. His sister in Singapore also wants to stay informed.

**Goals:** Know his mother's vitals every day without calling the caregiver repeatedly. Have records to share with the specialist neurologist. Allow his sister to view care records without friction. Be alerted immediately if something serious happens.

**CareLog Use Case:** Creates a workspace for eldercare. Invites both caregivers. Invites his sister as a viewer. Configures health monitoring (BP, SpO2, temperature, weight). Reviews the daily health log. Receives incident alerts for falls.

**Device:** iPad Pro, MacBook Pro, mobile Safari.

---

## 5. User Stories

### 5.1 Owner / Guardian Stories

#### Workspace & Profile Management

| ID | User Story | Priority |
|---|---|---|
| OWN-001 | As an owner, I want to create a workspace and care profile for my dependent so that I can organize their care in one place. | P0 |
| OWN-002 | As an owner, I want to invite a caregiver via a WhatsApp-shareable link so that they can start logging without a complex account setup. | P0 |
| OWN-003 | As an owner, I want to invite family members as read-only viewers so that remote family can stay informed. | P1 |
| OWN-004 | As an owner, I want to set standing instructions that the caregiver sees every day so that I don't have to repeat myself via WhatsApp. | P0 |
| OWN-005 | As an owner, I want to write daily notes for today only so that I can communicate context-specific instructions. | P0 |
| OWN-006 | As an owner, I want to assign tasks to the caregiver so that I can track completion of specific responsibilities. | P1 |
| OWN-007 | As an owner, I want multiple care profiles under one account so that I can track both my child and my elderly parent. | P1 |
| OWN-008A | As an owner, I want to assign multiple caregivers to one care recipient so that different caregivers (morning ART, night babysitter) can all submit reports for the same child. | P0 |
| OWN-008B | As an owner, I want to assign one caregiver to multiple care recipients so that a single ART who takes care of two children can report on both. | P0 |
| OWN-008C | As an owner, I want to revoke a caregiver's access to a specific child from the app so that when a caregiver leaves or is replaced, they can no longer see or submit reports for that child. | P0 |
| OWN-008D | As an owner, I want to see which caregivers are currently assigned to each child so that I always know who has access. | P0 |

#### Report Viewing

| ID | User Story | Priority |
|---|---|---|
| OWN-008 | As an owner, I want to view a chronological timeline of today's care events so that I can see what happened in order — including entries from all caregivers and from myself. | P0 |
| OWN-009 | As an owner, I want to browse care reports by date so that I can review historical records. | P0 |
| OWN-010 | As an owner, I want to view a weekly summary so that I can spot patterns across the week. | P1 |
| OWN-011 | As an owner, I want to receive a daily email summary at 5 PM so that I get a digest without opening the app. | P0 |
| OWN-012 | As an owner, I want to be immediately notified of any incident report so that I can respond quickly. | P0 |
| OWN-013 | As an owner, I want to log care entries for my dependent directly (e.g., the evening bath I give myself) so that the record is complete even for care I personally provide. | P0 |

### 5.2 Caregiver Stories

#### Onboarding & Shift Management

| ID | User Story | Priority |
|---|---|---|
| CGR-001 | As a caregiver, I want to accept a workspace invite from a WhatsApp link without creating a password so that I can start immediately. | P0 |
| CGR-002 | As a caregiver, I want to check in at the start of my shift so that my working hours are recorded. | P0 |
| CGR-003 | As a caregiver, I want to check out at the end of my shift so that my shift duration is logged. | P0 |
| CGR-004 | As a caregiver, I want to see today's instructions from the parent prominently so that I know what's expected. | P0 |

#### Daily Logging

| ID | User Story | Priority |
|---|---|---|
| CGR-005 | As a caregiver, I want to log an activity in real time by tapping a category button and selecting from chips so that logging takes under 30 seconds. | P0 |
| CGR-006 | As a caregiver, I want to backfill a care entry by selecting a past time slot so that I can log activities I forgot to record. | P0 |
| CGR-007 | As a caregiver, I want to submit a day-end count-based summary when I did not log in real time so that a record still exists. | P0 |
| CGR-008 | As a caregiver, I want to attach a photo to a care log entry so that I can show meal quality or a visible symptom. | P1 |
| CGR-009 | As a caregiver, I want to log health vitals (temperature, BP, SpO2, weight) so that the parent has a medical record. | P1 |
| CGR-010 | As a caregiver, I want to mark assigned tasks as complete so that the parent can see I followed their instructions. | P1 |

#### Incident Reporting

| ID | User Story | Priority |
|---|---|---|
| CGR-013 | As a caregiver, I want to file an incident report for unexpected events (fall, injury, vomiting) so that the parent is informed immediately. | P0 |
| CGR-014 | As a caregiver, I want to classify an incident by severity so that the parent knows how urgently to respond. | P0 |
| CGR-015 | As a caregiver, I want to attach photos to an incident report so that the parent can see visual evidence. | P0 |
| CGR-016 | As a caregiver, I want the incident form accessible from the home screen in one tap so that I can reach it during an emergency. | P0 |

### 5.3 Viewer / Family Member Stories

| ID | User Story | Priority |
|---|---|---|
| VWR-001 | As a family viewer, I want to accept a read-only invite link so that I can see reports without caregiver or owner access. | P1 |
| VWR-002 | As a family viewer, I want to browse the care timeline so that I stay informed from a different location. | P1 |
| VWR-003 | As a family viewer, I want to be notified of incident reports so that I know when something serious has happened. | P1 |

---

## 6. Functional Requirements

### Notation
- **P0:** Must ship in MVP (Weeks 1–12). Blocking.
- **P1:** Phase 1 post-launch (Month 3–6).
- **P2:** Phase 2 or later.

---

### 6.1 Authentication & Onboarding

| No. | Feature | Actor | Requirement | Note |
|---|---|---|---|---|
| AUTH-001 | **Magic link authentication** — *As a user, I want to sign up and log in via email magic link so that I don't need a password.* | All users | **Objective:** Reduce auth friction, especially for caregivers with lower digital literacy. **Acceptance Criteria:** (1) User enters email → receives magic link within 60 seconds. (2) Clicking link creates or resumes a session. (3) Link is single-use and expires after 15 minutes. (4) 30-day session persistence on trusted devices. (5) Expired link shows clear error with resend option. | P0 |
| AUTH-002 | **Google OAuth** — *As a user, I want to sign in with Google so that I can skip email verification.* | All users | **Acceptance Criteria:** (1) "Sign in with Google" button on auth screen. (2) OAuth 2.0 flow completes → account created or matched by email. (3) 30-day session created. (4) If email already exists via magic link, accounts are linked. | P0 |
| AUTH-003 | **WhatsApp-shareable invite link** — *As an owner, I want to share an invite via WhatsApp so that my caregiver can join without friction.* | Owner | **Acceptance Criteria:** (1) Owner generates invite link from workspace settings. (2) Link contains a signed cryptographic token. (3) Link valid for 72 hours, single-use. (4) Clicking opens CareLog → caregiver completes magic link auth → automatically added to workspace with Caregiver role. (5) Owner notified via email when invite is accepted. | P0 |
| AUTH-004 | **Role-based access control** | System | **Acceptance Criteria:** (1) Owner: full CRUD on workspace, profiles, instructions, reports. (2) Caregiver: create/edit own logs within same-day window, view instructions, check in/out, file incidents. (3) Viewer: read-only on reports and timeline. (4) No role can access another workspace's data. (5) Enforcement is at the database RLS layer, not only at the application layer. | P0 |

---

### 6.2 Workspace & Care Profile

| No. | Feature | Actor | Requirement | Note |
|---|---|---|---|---|
| WRK-001 | **Workspace creation** | Owner | **Acceptance Criteria:** (1) Owner provides workspace name. (2) Workspace created with unique slug. (3) Owner auto-assigned Owner role. (4) Workspace has isolated data scope. | P0 |
| WRK-002 | **Care profile creation** | Owner | **Acceptance Criteria:** (1) Fields: full name (required), date of birth (required), care type [child / infant / elderly / patient] (required), photo (optional), medical notes / allergies (optional). (2) Care type determines which log categories appear for the caregiver. (3) Free tier: second profile creation blocked with upgrade modal. (4) Profile editable and deletable by owner only. | P0 |
| WRK-003 | **Standing + daily instructions** | Owner | **Acceptance Criteria:** (1) Standing instructions: persistent, shown every day, support up to 1,000 characters. (2) Daily notes: visible only on the specified calendar date, max 500 characters. (3) Both displayed in a pinned banner on caregiver home screen, above quick-action buttons. (4) Standing notes are visually distinct (pinned icon, different color) from daily notes. (5) Notes cached locally for offline access. | P0 |
| WRK-004 | **Caregiver management** | Owner | **Acceptance Criteria:** (1) Owner can view all caregivers in workspace. (2) Owner can revoke access — revocation takes effect within 5 seconds across all sessions. (3) Revoked caregiver's historical logs are retained and visible to owner. (4) Revoked caregiver sees a clear "access removed" message if they try to open the app — no silent failure. (5) Owner receives a confirmation before revoking ("Cabut akses [nama] dari [nama anak]?"). | P0 |
| WRK-005 | **Multi-caregiver assignment** | Owner | **Acceptance Criteria:** (1) Owner can assign multiple caregivers to the same care recipient (e.g., morning ART + night babysitter for the same child). (2) Owner can assign one caregiver to multiple care recipients (e.g., one ART caring for two children). (3) Assignment is done from the care profile screen via an "Assign Caregiver" button — owner picks from existing workspace caregivers or sends a new invite. (4) Each care recipient shows a list of currently assigned caregivers with their status (active/revoked). (5) Owner can remove a caregiver from a specific child without removing them from the workspace entirely. (6) When a caregiver is assigned to a new child, they receive a notification and the child's profile appears on their home screen. (7) Free tier: maximum 3 caregivers per workspace (per plan_configs). Paid tiers: up to 10 (starter) or unlimited (pro). | P0 |

---

### 6.3 Caregiver Shift Tracking

| No. | Feature | Actor | Requirement | Note |
|---|---|---|---|---|
| SFT-001 | **Shift check-in** | Caregiver | **Acceptance Criteria:** (1) "Start Shift" button prominent on caregiver home screen. (2) System records check-in timestamp (stored as UTC, displayed in WIB). (3) Check-in visible to owner in real time. (4) Caregiver soft-blocked from logging entries before checking in, with one-tap override. **(5) Shift check-in is for caregivers only — owners log entries without a shift and are never prompted to check in.** | P0 |
| SFT-002 | **Shift check-out** | Caregiver | **Acceptance Criteria:** (1) "End Shift" button shown when a shift is active. (2) System records check-out timestamp. (3) Shift duration calculated and displayed. (4) Caregiver prompted to add optional handoff note visible to the incoming caregiver. (5) Checked-out caregiver retains read access to today's logs. | P0 |
| SFT-003 | **Shift handoff context for incoming caregiver** | Caregiver | **Acceptance Criteria:** (1) When a caregiver checks in and a shift already completed today for the same recipient, a "Handoff from [Name]" banner appears at the top of the caregiver home. (2) Banner shows: outgoing caregiver name, checkout time, handoff note (if any), and a summary count of entries already logged today (e.g. "3 meals · 1 nap · 2 diapers logged"). (3) Incoming caregiver can tap to expand and read all entries already logged. (4) Banner dismissed with one tap and does not re-appear in the same session. | P0 |
| SFT-004 | **Shift history for owner** | Owner | **Acceptance Criteria:** (1) List of all check-ins/check-outs per caregiver. (2) Displayed as: caregiver name, date, check-in time, check-out time, shift duration. (3) Filterable by caregiver and date range. | P0 |

---

### 6.4 Daily Care Logging (Three Input Modes)

| No. | Feature | Actor | Requirement | Note |
|---|---|---|---|---|
| LOG-001 | **Who can log entries** | System | **Acceptance Criteria:** (1) **Caregivers** can log entries for any care recipient they are actively assigned to. (2) **Owners** can log entries for any care recipient in their own workspace — without shift check-in, without assignment. (3) Every entry is tagged with the contributor's user ID, name, and role (`caregiver` or `owner`) for attribution on the timeline. (4) Owners log via the same category buttons and bottom-sheet chip UI as caregivers, accessible from the owner dashboard report view. | P0 |
| LOG-002 | **Mode 1: Quick Tap (Real-Time)** | Caregiver, Owner | **Acceptance Criteria:** (1) Home screen shows category buttons: Meals, Vitamins/Meds, Activities, Sleep, Diaper (child/infant only), Mood, Health, Notes. (2) Tapping opens a bottom sheet with pre-filled chip options. (3) Minimum chip touch target: 56×56px. (4) Time auto-fills to NOW. (5) All chips are optional except the category itself. (6) Zero required text fields — complete report submittable with zero typing. (7) Entry appears on today's timeline within 2 seconds of tapping "Save". (8) Voice-to-text available on optional notes fields via browser Web Speech API. | P0 |
| LOG-003 | **Mode 2: Backfill (Time Preset)** | Caregiver, Owner |**Acceptance Criteria:** (1) Accessible via "Kapan?" toggle on any category bottom sheet. (2) Time selection: preset chips in 30-min intervals OR broad blocks (Pagi/Siang/Sore). (3) No time-picker wheel — tap chips only. (4) Restricted to current calendar day only. (5) Entry inserted into timeline in correct chronological order. | P0 |
| LOG-004 | **Mode 3: Quick Summary (End-of-Day)** | Caregiver | **Acceptance Criteria:** (1) Triggered when caregiver opens report and timeline is empty after 4 PM. (2) Prompt: "Belum ada aktivitas. Isi ringkasan cepat?" with [Start Now] / [Backfill] / [Quick Summary] options. (3) Count-based UI: Meals (0–4+), Vitamins (all/partial/none), Sleep duration chips, Diaper count (0–5+), Mood emoji scale. (4) Completable in under 30 seconds with zero typing. (5) Submitted summary labeled "Ringkasan" (Summary) in parent view so parents know it's a quick fill. | P0 |
| LOG-005 | **Log categories (P0 chip sets)** | Caregiver | **Meals:** Breakfast / Lunch / Dinner / Snack / Milk / Formula + portion chips (Finished/Half/Refused) + food chips (Nasi, Bubur, Susu, Roti, Buah, Sayur, Telur, Mie, Biskuit) + "(+) Lainnya". **Vitamins/Meds:** Vitamin D / Iron / Multivitamin / Custom + Given/Refused toggle. **Activities:** Outdoor Play / Indoor Play / Reading / TV / Bath / Walk + child chips: Educational Toy / Drawing / Singing. **Sleep:** Morning Nap / Afternoon Nap / Night Sleep + start/end time + quality (Restful/Restless/Interrupted). **Diaper (child/infant only):** Wet / Dirty / Both / Dry. **Mood:** Happy / Calm / Fussy / Crying / Sleepy / Irritable. **Health:** Temperature (°C) + Chips: Sneezing / Coughing / Vomiting / Rash / Normal. **Notes:** Free text, max 500 chars. | P0 |
| LOG-006 | **Auto-save drafts** | System | **Acceptance Criteria:** (1) Report auto-saves every 30 seconds to IndexedDB (offline) and server (online). (2) Drafts persist across app restarts. (3) Save indicator shows "Tersimpan" with last save time. | P0 |

---

### 6.5 Incident Reporting

| No. | Feature | Actor | Requirement | Note |
|---|---|---|---|---|
| INC-001 | **Incident report button** | Caregiver | **Acceptance Criteria:** (1) Red "Report Incident" button (exclamation icon) always visible on caregiver home screen. (2) Accessible in 1 tap from any home screen state. (3) Does not require caregiver to be checked in. | P0 |
| INC-002 | **Incident form fields** | Caregiver | **Acceptance Criteria:** (1) Incident Type [Fall / Injury / Medical / Behavioral / Environmental / Other] (required). (2) Severity [Low / Medium / High / Emergency] (required). (3) Time of incident (required, defaults to now, editable). (4) Description (free text, required, min 20 chars, max 1,000 chars). (5) Action taken (optional, max 500 chars). (6) Photos (optional, up to 5, each < 5 MB). (7) Submission takes < 3 taps after opening the form. | P0 |
| INC-003 | **Severity visual indicators** | System | **Acceptance Criteria:** Low = green badge; Medium = amber badge; High = red badge; Emergency = pulsing red badge. Color never the sole differentiator — always accompanied by text label. | P0 |
| INC-004 | **Immediate owner notification** | System | **Acceptance Criteria:** (1) Owner receives push notification AND email within 60 seconds of incident submission. (2) Notification includes: care recipient name, incident type, severity, time. (3) Deep link to incident detail view. (4) Opt-in viewers with incident notifications enabled also notified. | P0 |
| INC-005 | **Incident log for owner** | Owner | **Acceptance Criteria:** (1) Dedicated "Incidents" tab in owner dashboard. (2) Sorted by time descending. (3) Filterable by severity, date range, and care profile. (4) Each row: type, severity, time, caregiver name. (5) Tapping row opens full incident detail. | P0 |

---

### 6.6 Health Monitoring (P1)

| No. | Feature | Actor | Requirement | Note |
|---|---|---|---|---|
| HLT-001 | **Structured vital sign logging** | Caregiver | **Acceptance Criteria:** (1) Log: Temperature (°C, 34.0–42.0), Blood Pressure (systolic/diastolic mmHg), SpO2 (%, 70–100), Weight (kg, 1–300). (2) Each vital has its own log entry with timestamp. (3) Invalid ranges blocked with inline error. | P1 |
| HLT-002 | **Vital history chart for owner** | Owner | **Acceptance Criteria:** (1) Line chart per vital: 7-day / 30-day / 90-day views. (2) Interactive (tap point to see value + timestamp). (3) Empty state with illustration if no data. | P1 |
| HLT-003 | **Alert thresholds** | Owner | **Acceptance Criteria:** (1) Owner configures alert thresholds per vital (e.g., temperature > 38.5°C). (2) Threshold breach triggers push + email within 60 seconds. (3) Alert contains: vital type, value, threshold, time, caregiver who logged it. | P1 |

---

### 6.7 Task Management (P1)

| No. | Feature | Actor | Requirement | Note |
|---|---|---|---|---|
| TSK-001 | **Owner creates task** | Owner | **Acceptance Criteria:** (1) Task fields: title (required, max 100 chars), description (optional), due date (required), due time (optional), assigned caregiver, care profile. (2) Task immediately visible to assigned caregiver. | P1 |
| TSK-002 | **Caregiver updates task status** | Caregiver | **Acceptance Criteria:** (1) Tasks section on home screen, sorted by due time. (2) Statuses: To Do → In Progress → Done. (3) Status change visible to owner within 5 seconds. | P1 |
| TSK-003 | **Overdue task notification** | System | **Acceptance Criteria:** (1) If task due time passes and status ≠ Done → owner receives in-app notification. (2) Sent once per overdue task. | P1 |

---

### 6.8 Report Viewing

| No. | Feature | Actor | Requirement | Note |
|---|---|---|---|---|
| RPT-001 | **Unified daily care timeline** | Owner | **Objective:** Give owners a single, complete picture of the day regardless of how many caregivers or contributors logged entries. **Acceptance Criteria:** (1) All care entries for the selected profile and date are merged into one **chronological timeline**, regardless of which caregiver or the owner contributed them. (2) Each entry is attributed with: contributor name, contributor role badge (`Pengasuh Pagi` / `Pengasuh Malam` / `Orang Tua` etc.), and submission time. (3) Contributor role badge color-codes by user: e.g. morning nanny = blue, night nanny = green, owner = purple. (4) If >2 contributors exist for the day, a "Contributors today" pill at the top of the timeline lists all contributors. (5) Timeline refreshes automatically every 60 seconds. (6) Incidents section pinned at top, visually distinct. | P0 |
| RPT-002 | **Contributor filter on timeline** | Owner | **Acceptance Criteria:** (1) Owner can filter the timeline to show entries from one contributor only (e.g., "Show only Morning Nanny"). (2) Filter presented as horizontally scrollable contributor chips above the timeline. (3) "All" chip selected by default. | P0 |
| RPT-003 | **Date browsing** | Owner | **Acceptance Criteria:** (1) Date picker or prev/next navigation. (2) Free tier: last 7 calendar days only. (3) Paid tier: any date with logged data. (4) Dates with no data show helpful empty state. | P0 |
| RPT-004 | **Shift summary cards on timeline** | Owner | **Acceptance Criteria:** (1) Timeline includes one shift card per caregiver who checked in that day. (2) Each shift card shows: caregiver name, check-in time, check-out time or "Still on shift", shift duration, handoff note if provided. (3) Shift cards appear inline in the timeline at the check-in timestamp — not pinned to top. | P0 |
| RPT-005 | **Cross-contributor visibility for caregivers** | Caregiver | **Objective:** Incoming shift caregiver must have awareness of what was logged earlier in the day so that care is continuous and nothing is duplicated. **Acceptance Criteria:** (1) A caregiver can see all entries logged by other contributors (caregivers and owner) for the same recipient on the same day. (2) Read access is granted to any workspace member who has an active or completed shift for the recipient that day. (3) Entries from other contributors are visually differentiated (lighter background, contributor attribution shown). (4) Caregiver cannot edit or delete another contributor's entries. | P0 |
| RPT-006 | **Weekly summary (paid)** | Owner | **Acceptance Criteria:** (1) 7-day aggregate view: meals per day, vitamin adherence, total sleep hours, mood distribution, diaper count. (2) Highlights anomalies (e.g., "Vitamins missed 3 of 5 days"). (3) Navigation by week. | P1 |
| RPT-007 | **Daily email digest at 5 PM WIB** | System | **Acceptance Criteria:** (1) Email sent to owner at 17:00 WIB daily. (2) Includes: date, profile name, summary counts per category, shift times, incident summary. (3) Sent even on days with no logs (states "No entries today"). (4) Deep link back to full report. | P0 |

---

### 6.9 Notifications

| No. | Feature | Actor | Requirement | Note |
|---|---|---|---|---|
| NOT-001 | **Daily 5 PM reminder to caregiver** | System | **Acceptance Criteria:** (1) Email sent to caregiver at 17:00 WIB if no log entry submitted. (2) Direct link to logging screen. (3) If already logged: no email sent. (4) Max 1 reminder per caregiver per day. (5) Stops after 14 days of inactivity. (6) Caregiver can snooze (1 day) or disable from settings. | P0 |
| NOT-002 | **In-app notification center** | All users | **Acceptance Criteria:** (1) Notification bell icon in nav. (2) Opens panel with reverse-chronological list. (3) Unread count badge. (4) Marking as read clears badge. | P0 |
| NOT-003 | **Smart reminders (paid)** | System | **Acceptance Criteria:** (1) Owner configures up to 5 custom reminder times per care profile per day. (2) Sent as push notifications. (3) Example: "Log morning meds at 8 AM". | P1 |

---

### 6.10 Bilingual Support

| No. | Feature | Actor | Requirement | Note |
|---|---|---|---|---|
| I18N-001 | **Bahasa Indonesia + English** | System | **Acceptance Criteria:** (1) All UI labels, buttons, error messages, email templates in both ID and EN. (2) Human-translated strings only for P0 (no machine translation). (3) Default: Bahasa Indonesia. (4) Language toggle in settings, takes effect immediately. (5) i18n architecture supports adding new languages without code changes. | P0 |
| I18N-002 | **Timezone handling** | System | **Acceptance Criteria:** (1) `report_date` stored as `DATE` (no timezone). (2) Client sends local calendar date via `Intl.DateTimeFormat`. (3) All "reports due today" queries use workspace timezone. (4) Workspace timezone stored in DB (default: Asia/Jakarta). (5) Display uses `date-fns-tz`. | P0 |

---

### 6.11 Subscription & Payment

#### Payment Gateway

CareLog uses **Midtrans** (by GoTo/Tokopedia) as the payment gateway. Midtrans is the most widely adopted payment gateway in Indonesia, supports all major local payment methods, and has clear documentation for recurring subscription billing.

| Midtrans Feature | CareLog Usage |
|---|---|
| Snap (hosted payment page) | Primary checkout UI — handles all payment methods in one page |
| Core API (server-to-server) | Subscription renewal, cancellation, refund processing |
| Webhooks | Payment confirmation, subscription status changes |
| Recurring API | Auto-charge for monthly/annual subscribers (card and e-wallet) |
| Sandbox | Testing with simulated transactions before go-live |

**Why Midtrans over alternatives:** Midtrans supports the widest range of Indonesian payment methods in a single integration. The Snap checkout page is mobile-optimized and handles PCI compliance — CareLog never touches raw card data. Fees are 2.6–2.9% per transaction, competitive with Xendit and significantly cheaper than Stripe (3.5%) for Indonesian transactions.

#### Accepted Payment Methods

Indonesian credit card penetration is approximately 6-7%. CareLog must support the payment methods that Indonesian middle-class families actually use.

| Priority | Method | How It Works | Auto-Renew? |
|---|---|---|---|
| P0 | **QRIS** | User scans QR code from any banking or e-wallet app (GoPay, OVO, DANA, ShopeePay, mobile banking). Universal standard — one QR works with all apps. | No — manual renewal each cycle |
| P0 | **GoPay** | Direct e-wallet charge via Midtrans GoPay integration. Deeplink opens Gojek app for confirmation. | Yes — tokenized for recurring |
| P0 | **Virtual Account (bank transfer)** | User receives unique VA number, transfers from any Indonesian bank (BCA, BNI, Mandiri, BRI, Permata). Most trusted method for larger amounts. | No — manual renewal each cycle |
| P0 | **Alfamart / Indomaret** | User receives payment code, pays cash at nearest convenience store counter. Important for users without bank accounts or e-wallets. | No — manual renewal each cycle |
| P1 | **OVO** | Direct e-wallet charge. Deeplink opens OVO app. | Yes — tokenized for recurring |
| P1 | **DANA** | Direct e-wallet charge. Deeplink opens DANA app. | Yes — tokenized for recurring |
| P1 | **ShopeePay** | Direct e-wallet charge. Deeplink opens Shopee app. | Yes — tokenized for recurring |
| P1 | **Credit/Debit Card** | Visa, Mastercard, JCB via Midtrans Snap. 3D Secure required. | Yes — tokenized for recurring |

**Auto-renew vs. manual renewal:** Payment methods that support tokenization (GoPay, OVO, DANA, ShopeePay, cards) can auto-renew. For non-tokenized methods (QRIS, VA, convenience store), the system sends a renewal reminder 3 days before expiry and gives a 3-day grace period after expiry before downgrading to free tier.

#### Pricing & Billing Cycles

| Plan | Monthly | Annual (save 17%) | Per-Month Equivalent (Annual) |
|---|---|---|---|
| **Free** | Rp 0 | — | — |
| **Starter** | Rp 49,000/month | Rp 490,000/year | Rp 40,833/month |
| **Pro** | Rp 79,000/month | Rp 790,000/year | Rp 65,833/month |

**Pricing rationale:** Rp 49,000/month is approximately the cost of 2 cups of kopi susu at a typical Indonesian coffee chain — affordable for the middle-class families who employ ART. Annual pricing is set at 10 months' worth (pay 10, get 12) giving a clean 17% discount that's easy to communicate: "Hemat 2 bulan!" (Save 2 months!).

**Pricing localization:** All prices displayed in Rupiah (Rp) with no decimal places. When CareLog expands internationally, prices will be regionalized using Midtrans multi-currency or a separate gateway per market.

#### Free Trial

| Parameter | Value |
|---|---|
| Trial duration | 14 days |
| Trial scope | Full Pro plan features |
| Payment required to start? | No — trial starts automatically on signup |
| What happens after trial? | Account drops to Free tier (no data lost, features gated) |
| Can trial be restarted? | No — one trial per account (tracked by `trial_started_at`) |
| Trial reminder emails | Day 10: "4 hari lagi trial berakhir" / Day 13: "Besok trial berakhir — upgrade sekarang" |

**Trial flow:**
1. New user signs up → automatically gets 14-day Pro trial
2. During trial, all Pro features are unlocked (unlimited profiles, full history, smart reminders, photo gallery)
3. Day 10: email reminder with trial status and upgrade CTA
4. Day 13: final reminder with comparison of what they'll lose
5. Day 15: trial expires → account drops to Free tier
6. Free tier limits apply immediately (only 1 profile visible, 7-day history)
7. No data is deleted — upgrading later immediately restores access to all profiles and history

#### Subscription Lifecycle

```
[New User] → 14-day Pro Trial (no payment)
     │
     ├── User upgrades during trial → Subscription starts, trial ends
     │        │
     │        ├── Auto-renew ON (GoPay/OVO/DANA/Card)
     │        │      → Midtrans charges automatically each cycle
     │        │      → Failed charge → 3 retry attempts over 3 days
     │        │      → All retries fail → 3-day grace period → downgrade to Free
     │        │
     │        └── Auto-renew OFF (QRIS/VA/Convenience Store)
     │               → Renewal reminder email: 3 days before expiry
     │               → Payment link in email + in-app banner
     │               → Expiry → 3-day grace period → downgrade to Free
     │
     └── Trial expires without upgrade → Free tier
              │
              └── User upgrades later → Subscription starts, all data restored
```

#### Subscription Requirements

| No. | Feature | Actor | Requirement | Note |
|---|---|---|---|---|
| SUB-001 | **Pricing page** | Owner | **Acceptance Criteria:** (1) Shows Free vs Starter vs Pro comparison table. (2) Monthly/Annual toggle with "Hemat 2 bulan!" badge on annual. (3) Current plan highlighted. (4) "Mulai 14 Hari Gratis" (Start 14-Day Free Trial) for new users. (5) "Upgrade Sekarang" (Upgrade Now) for existing free users. (6) Accessible from settings, upgrade modals, and `/pricing` page. | P0 |
| SUB-002 | **Checkout flow** | Owner | **Acceptance Criteria:** (1) Tapping upgrade opens Midtrans Snap checkout in-app (not a redirect). (2) Snap shows all enabled payment methods. (3) After successful payment, subscription activates within 30 seconds. (4) Confirmation screen shows: plan name, next billing date, payment method used. (5) Confirmation email sent with receipt. | P0 |
| SUB-003 | **Subscription management** | Owner | **Acceptance Criteria:** (1) Settings page shows: current plan, billing cycle, next renewal date, payment method. (2) Owner can switch between monthly and annual (prorated). (3) Owner can cancel subscription — access continues until end of current period. (4) Owner can update payment method. (5) Cancel flow asks for reason (optional) before confirming. | P0 |
| SUB-004 | **Grace period** | System | **Acceptance Criteria:** (1) Failed renewal or expired manual payment → 3-day grace period. (2) During grace period: full access continues, in-app banner warns "Pembayaran gagal — perbarui sebelum [tanggal]" (Payment failed — renew before [date]). (3) After grace period: downgrade to Free tier. (4) No data deleted on downgrade — features gated only. | P0 |
| SUB-005 | **Upgrade prompts** | System | **Acceptance Criteria:** (1) When user hits a free tier limit (2nd profile, 8th day of history, smart reminder toggle), show upgrade modal. (2) Modal shows what they're missing + pricing + one-tap upgrade button. (3) Maximum 1 upgrade modal per session (no nagging). (4) Upgrade prompts are never shown to caregivers — only to workspace owners. | P0 |
| SUB-006 | **Midtrans webhooks** | System | **Acceptance Criteria:** (1) Webhook endpoint at `/api/webhooks/midtrans` verifies Midtrans signature. (2) Handles events: `capture`, `settlement`, `pending`, `deny`, `expire`, `cancel`, `refund`. (3) Webhook handler is idempotent (same event processed twice has no side effect). (4) Daily reconciliation cron compares Midtrans transaction status with local subscription state. (5) Webhook failures logged and alerted. | P0 |
| SUB-007 | **Refund policy** | Owner | **Acceptance Criteria:** (1) Full refund available within 7 days of first-ever payment. (2) After 7 days: no refund for current billing period, but cancellation stops future charges. (3) Refund processed via Midtrans refund API. (4) Refund confirmation email sent. | P0 |

#### Revenue Tracking

| Metric | Definition | Target (Month 12) |
|---|---|---|
| MRR | Sum of all active monthly subscription values | Rp 15,000,000 |
| Free-to-paid conversion | % of free users who upgrade within 30 days | ≥ 8% |
| Trial-to-paid conversion | % of trial users who subscribe before/after trial | ≥ 25% |
| Monthly churn rate | % of paid subscribers who cancel in a given month | < 5% |
| ARPU | Average revenue per paying user per month | Rp 55,000 |
| LTV | Average total revenue per paying user over lifetime | Rp 660,000 (12-month avg) |
| Payment method distribution | % of transactions per payment method | Track, no target |

---

## 7. Non-Functional Requirements

### 7.1 Performance

| ID | Requirement | Target | Measurement |
|---|---|---|---|
| PERF-001 | Time to Interactive (mobile 4G) | < 3 seconds | Lighthouse CI |
| PERF-002 | Log entry submission (tap → timeline update) | < 2 seconds P95 | API response + client render |
| PERF-003 | Incident notification delivery | < 60 seconds P95 | Submit timestamp to delivery timestamp |
| PERF-004 | Daily timeline load (100 entries) | < 2 seconds P95 | API response |
| PERF-005 | Photo upload (5 MB, 4G) | < 5 seconds | Client-side compression + upload |
| PERF-006 | JS bundle size (initial load) | < 200 KB gzipped | `next build` + bundle analyzer |

### 7.2 Security

| ID | Requirement | Standard |
|---|---|---|
| SEC-001 | Workspace data isolation | RLS at DB level + API layer |
| SEC-002 | Authentication token security | Single-use magic links; httpOnly cookies; no tokens in localStorage |
| SEC-003 | Invite link security | Cryptographic token, single-use, 72-hour expiry |
| SEC-004 | Photo storage | Private buckets, signed URLs (1-hour TTL) |
| SEC-005 | PII protection | No PII in logs; AES-256 at rest |
| SEC-006 | HTTPS | TLS 1.2+; HSTS header |
| SEC-007 | Input validation | Server-side sanitization on all inputs |

### 7.3 Reliability & Availability

| ID | Requirement | Target |
|---|---|---|
| REL-001 | Service uptime | 99.5% monthly |
| REL-002 | Data durability | 99.999% — daily backups, 30-day retention |
| REL-003 | Graceful degradation | Email fallback if push fails; in-app fallback if email fails |

### 7.4 Accessibility

| ID | Requirement | Standard |
|---|---|---|
| ACC-001 | WCAG 2.1 AA compliance | All P0 screens |
| ACC-002 | Minimum touch target | 44×44px (iOS HIG) on all interactive elements |
| ACC-003 | Color contrast | 4.5:1 normal text, 3:1 large text |
| ACC-004 | Font size floor | 16px body text on caregiver-facing screens |
| ACC-005 | No hover-only interactions | All desktop hover interactions must also work via tap |

### 7.5 Browser & Device Compatibility

| ID | Requirement | Target |
|---|---|---|
| COMPAT-001 | Mobile browsers | Chrome Android (last 2), Safari iOS 15+ (last 2), Samsung Internet (last 2) |
| COMPAT-002 | Desktop browsers | Chrome, Firefox, Safari, Edge (last 2 major versions) |
| COMPAT-003 | Minimum viewport | 360px width (Samsung Galaxy A14 class) |
| COMPAT-004 | Network conditions | Fully usable on 3G (300 kbps); graceful degradation on 2G |

---

## 8. MVP Scope

### 8.1 Scope Philosophy

The MVP must answer: **"Will a caregiver in Indonesia log care data daily if we give them a fast, simple interface — and will parents find that data valuable enough to pay for more?"**

### 8.2 MVP Feature Set (Weeks 1–12)

| Area | Features | Weeks |
|---|---|---|
| Auth & Onboarding | Magic link, Google OAuth, WhatsApp invite, bilingual scaffolding | 1–2 |
| Workspace & Profiles | Workspace creation, care profile CRUD, free tier enforcement (1 profile), multi-caregiver assignment & revocation | 2–3 |
| Shift Tracking | Check-in/check-out, shift history | 3 |
| Daily Logging — Mode 1 | Quick tap, all P0 categories, bottom sheet UI | 4–5 |
| Daily Logging — Mode 2 & 3 | Backfill + end-of-day quick summary | 5–6 |
| Incident Reporting | Incident form, severity, immediate notification | 5–6 |
| Parent Instructions | Standing + daily notes, pinned to caregiver home | 6–7 |
| Report Viewing | Owner timeline, date browsing, 7-day limit, shift card | 6–7 |
| Notifications | Daily email digest (5 PM), caregiver reminder, in-app center | 7–8 |
| Subscription & Payment | Midtrans integration, pricing page, checkout flow, webhook handler, free trial logic, upgrade prompts, subscription management | 9–10 |
| QA & Performance | Cross-device testing, accessibility audit, Lighthouse CI | 10–11 |
| Beta Launch | 50 pilot households in Jakarta | 11–12 |

### 8.3 Explicitly Out of Scope for MVP

| Feature | Deferred To |
|---|---|
| Health vital structured logging (BP, SpO2, weight) | P1 |
| Vital trend charts and alert thresholds | P1 |
| Task management | P1 |
| Learning & Development tracking | P1 |
| Therapy & Rehabilitation tracking | P1 |
| Weekly summary view | P1 |
| Photo gallery | P1 |
| Multi-viewer access | P1 |
| Smart / custom reminders | P1 |
| Incident acknowledgment & comments | P1 |
| PDF export | P2 |
| AI daily summary | P2 |
| AI risk detection | P2 |
| Caregiver performance dashboard | P2 |
| Native mobile apps (iOS/Android) | P2 |
| Organization / agency accounts | P2 |
| Offline PWA sync | P2 |

### 8.4 MVP Success Criteria (Go/No-Go for Launch)

| Criterion | Threshold |
|---|---|
| Caregiver completes first log from fresh invite link | < 5 minutes, unassisted |
| Incident notification delivery | < 60 seconds P95 |
| Daily timeline load time | < 2 seconds P95 |
| Zero P0 security findings in pre-launch review | 0 critical/high CVEs unresolved |
| All P0 acceptance criteria verified | 100% pass in QA |
| Bilingual string coverage | 100% ID and EN for all P0 screens |
| Cross-device validation | Passes on Samsung Galaxy A14, iPhone 14, Chrome desktop |

---

## 9. Future Roadmap

### 9.1 Phase 1 — Growth & Depth (Month 3–6)

| Feature | Description | Priority |
|---|---|---|
| Health monitoring | Vital sign logging (BP, SpO2, temp, weight), trend charts, alert thresholds | P1 |
| Task management | Owner assigns tasks; caregiver marks complete; overdue notifications | P1 |
| Learning & Development tracking | Child: reading, writing, educational games with duration tracking | P1 |
| Therapy & Rehab tracking | Elderly/patient: physiotherapy, cognitive exercises with compliance tracking | P1 |
| Multi-viewer access | Family members invited as read-only viewers with opt-in incident notifications | P1 |
| Weekly summary view | 7-day aggregate: meals, vitamins, sleep, mood distribution (paid feature) | P1 |
| Photo gallery | Per-recipient chronological photo timeline | P1 |
| Smart reminders | Owner configures up to 5 custom push reminders per day per profile | P1 |
| Incident acknowledgment | Owner acknowledges and comments on incidents; status tracking | P1 |

### 9.2 Phase 2 — Intelligence & Scale (Month 7–18)

| Feature | Description | Priority |
|---|---|---|
| AI daily summary | LLM-generated narrative summaries in ID/EN from structured log data | P2 |
| AI risk detection | Pattern detection: missed meds, reduced food intake, irregular sleep, vital trends | P2 |
| Caregiver performance dashboard | Log completeness, shift punctuality, task completion rate (framed as coaching, not surveillance) | P2 |
| Native mobile apps | React Native iOS + Android; background push, biometric auth, offline-first with WatermelonDB | P2 |
| PDF export | Care history export formatted for medical sharing; paid feature | P2 |
| Organization accounts | Daycare centers, home care agencies — multi-caregiver, multi-family, admin dashboard | P2 |
| Customizable templates | Owner configures which log categories appear; custom activity types | P2 |
| Offline mode (PWA) | Service Worker + IndexedDB offline log capture; sync on reconnect with conflict resolution | P2 |

---

## 10. Database Schema

### 10.1 Core Tables

#### `workspaces` — Multi-tenant root entity

```sql
CREATE TABLE workspaces (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  owner_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  plan            TEXT NOT NULL DEFAULT 'free'
                    CHECK (plan IN ('free', 'starter', 'pro', 'enterprise')),
  plan_expires_at TIMESTAMPTZ,
  timezone        TEXT NOT NULL DEFAULT 'Asia/Jakarta',
  locale          TEXT NOT NULL DEFAULT 'id',
  max_recipients  INT NOT NULL DEFAULT 2,
  max_caregivers  INT NOT NULL DEFAULT 3,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_workspaces_slug ON workspaces(slug);
CREATE INDEX idx_workspaces_owner_id ON workspaces(owner_id);
```

#### `workspace_members` — Tenant membership + roles

```sql
CREATE TABLE workspace_members (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role          TEXT NOT NULL CHECK (role IN ('owner', 'caregiver', 'viewer')),
  invited_by    UUID REFERENCES auth.users(id),
  invited_at    TIMESTAMPTZ,
  accepted_at   TIMESTAMPTZ,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, user_id)
);

CREATE INDEX idx_workspace_members_workspace_id ON workspace_members(workspace_id);
CREATE INDEX idx_workspace_members_user_id ON workspace_members(user_id);
```

#### `invitations` — Pending membership invites

```sql
CREATE TABLE invitations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  invited_by    UUID NOT NULL REFERENCES auth.users(id),
  email         TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('caregiver', 'viewer')),
  token         TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '72 hours',
  accepted_at   TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invitations_token ON invitations(token);
CREATE INDEX idx_invitations_workspace_id ON invitations(workspace_id);
```

#### `care_recipients` — Child/elder/patient profiles

```sql
CREATE TABLE care_recipients (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  full_name     TEXT NOT NULL,
  display_name  TEXT,
  date_of_birth DATE,
  care_type     TEXT NOT NULL CHECK (care_type IN ('child', 'infant', 'elderly', 'patient')),
  gender        TEXT CHECK (gender IN ('male', 'female', 'other')),
  photo_url     TEXT,
  notes         TEXT,            -- standing/permanent notes from guardian
  medical_notes TEXT,            -- allergies, conditions (sensitive — not shown to viewers)
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_by    UUID NOT NULL REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_care_recipients_workspace_id ON care_recipients(workspace_id);
```

#### `caregiver_assignments` — Which caregiver covers which recipient

```sql
CREATE TABLE caregiver_assignments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  caregiver_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id    UUID NOT NULL REFERENCES care_recipients(id) ON DELETE CASCADE,
  assigned_by     UUID NOT NULL REFERENCES auth.users(id),
  assigned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unassigned_at   TIMESTAMPTZ,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  UNIQUE(caregiver_id, recipient_id)
);

CREATE INDEX idx_caregiver_assignments_caregiver_id ON caregiver_assignments(caregiver_id);
CREATE INDEX idx_caregiver_assignments_recipient_id ON caregiver_assignments(recipient_id);
```

#### `shifts` — Caregiver check-in/check-out records

```sql
CREATE TABLE shifts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  caregiver_id    UUID NOT NULL REFERENCES auth.users(id),
  recipient_id    UUID NOT NULL REFERENCES care_recipients(id),
  shift_date      DATE NOT NULL,
  checked_in_at   TIMESTAMPTZ NOT NULL,
  checked_out_at  TIMESTAMPTZ,
  summary_notes   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_shifts_caregiver_id ON shifts(caregiver_id);
CREATE INDEX idx_shifts_workspace_date ON shifts(workspace_id, shift_date DESC);
```

#### `daily_reports` — One per recipient per contributor per calendar date

A "contributor" is any workspace member who logs entries: an assigned caregiver OR the workspace owner logging care they personally provided.

```sql
CREATE TABLE daily_reports (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  recipient_id     UUID NOT NULL REFERENCES care_recipients(id) ON DELETE CASCADE,
  contributor_id   UUID NOT NULL REFERENCES auth.users(id),  -- caregiver OR owner
  contributor_role TEXT NOT NULL DEFAULT 'caregiver'
                     CHECK (contributor_role IN ('caregiver', 'owner')),
  report_date      DATE NOT NULL,
  status           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'submitted', 'acknowledged')),
  mood             TEXT CHECK (mood IN ('great', 'good', 'neutral', 'fussy', 'unwell')),
  report_type      TEXT NOT NULL DEFAULT 'detailed'
                     CHECK (report_type IN ('detailed', 'summary')),
  overall_notes    TEXT,
  submitted_at     TIMESTAMPTZ,
  acknowledged_at  TIMESTAMPTZ,
  acknowledged_by  UUID REFERENCES auth.users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One report per (recipient, date, contributor) — allows morning nanny + night nanny + owner
  UNIQUE(recipient_id, report_date, contributor_id)
);

CREATE INDEX idx_daily_reports_recipient_date ON daily_reports(recipient_id, report_date DESC);
CREATE INDEX idx_daily_reports_workspace_id ON daily_reports(workspace_id);
CREATE INDEX idx_daily_reports_contributor_id ON daily_reports(contributor_id);
-- Composite: fetch all contributors for a given recipient+date (used for unified timeline)
CREATE INDEX idx_daily_reports_recipient_date_role
  ON daily_reports(recipient_id, report_date DESC, contributor_role);
```

#### `report_entries` — Individual activity log items within a report

```sql
CREATE TABLE report_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id       UUID NOT NULL REFERENCES daily_reports(id) ON DELETE CASCADE,
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  category        TEXT NOT NULL
                    CHECK (category IN (
                      'meal', 'sleep', 'diaper', 'medication',
                      'activity', 'mood', 'health', 'learning',
                      'therapy', 'note', 'other'
                    )),
  occurred_at     TIMESTAMPTZ NOT NULL,
  duration_minutes INT,
  value           TEXT,
  notes           TEXT,
  photo_urls      TEXT[] DEFAULT '{}',
  metadata        JSONB DEFAULT '{}',  -- category-specific structured data
  created_by      UUID NOT NULL REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_report_entries_report_id ON report_entries(report_id);
CREATE INDEX idx_report_entries_workspace_id ON report_entries(workspace_id);
CREATE INDEX idx_report_entries_occurred_at ON report_entries(occurred_at DESC);
CREATE INDEX idx_report_entries_metadata ON report_entries USING GIN(metadata);
```

#### `incidents` — Incident reports (separate from daily log)

```sql
CREATE TABLE incidents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  recipient_id    UUID NOT NULL REFERENCES care_recipients(id),
  reported_by     UUID NOT NULL REFERENCES auth.users(id),
  incident_type   TEXT NOT NULL CHECK (incident_type IN (
                    'fall', 'injury', 'medical', 'behavioral',
                    'environmental', 'other'
                  )),
  severity        TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'emergency')),
  occurred_at     TIMESTAMPTZ NOT NULL,
  description     TEXT NOT NULL,
  action_taken    TEXT,
  photo_urls      TEXT[] DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'acknowledged', 'resolved')),
  acknowledged_by UUID REFERENCES auth.users(id),
  acknowledged_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_incidents_workspace_id ON incidents(workspace_id, occurred_at DESC);
CREATE INDEX idx_incidents_recipient_id ON incidents(recipient_id);
```

#### `parent_notes` — Async instructions from guardian to caregiver

```sql
CREATE TABLE parent_notes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  recipient_id    UUID NOT NULL REFERENCES care_recipients(id) ON DELETE CASCADE,
  author_id       UUID NOT NULL REFERENCES auth.users(id),
  note_type       TEXT NOT NULL CHECK (note_type IN ('daily', 'standing')),
  applicable_date DATE,   -- NULL for standing notes
  content         TEXT NOT NULL,
  is_dismissed    BOOLEAN NOT NULL DEFAULT false,
  dismissed_by    UUID REFERENCES auth.users(id),
  dismissed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_parent_notes_recipient_id ON parent_notes(recipient_id);
CREATE INDEX idx_parent_notes_applicable_date ON parent_notes(applicable_date)
  WHERE applicable_date IS NOT NULL;
```

#### `notifications` — Persistent notification log

```sql
CREATE TABLE notifications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  recipient_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type              TEXT NOT NULL,
  channel           TEXT NOT NULL CHECK (channel IN ('in_app', 'email', 'push')),
  title             TEXT NOT NULL,
  body              TEXT,
  payload           JSONB DEFAULT '{}',
  is_read           BOOLEAN NOT NULL DEFAULT false,
  read_at           TIMESTAMPTZ,
  sent_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_recipient ON notifications(recipient_user_id, is_read, created_at DESC);
```

#### `audit_logs` — Immutable change history

```sql
CREATE TABLE audit_logs (
  id            BIGSERIAL PRIMARY KEY,
  workspace_id  UUID REFERENCES workspaces(id),
  actor_id      UUID REFERENCES auth.users(id),
  action        TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id   TEXT NOT NULL,
  old_value     JSONB,
  new_value     JSONB,
  ip_address    INET,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_workspace_created ON audit_logs(workspace_id, created_at DESC);
```

### 10.2 Row Level Security (RLS) Policies

All tables have RLS enabled and forced. Core pattern:

```sql
-- Helper: resolve caller's role in a given workspace
CREATE OR REPLACE FUNCTION get_my_workspace_role(ws_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role
  FROM workspace_members
  WHERE workspace_id = ws_id
    AND user_id = auth.uid()
    AND is_active = true
  LIMIT 1;
$$;
```

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `workspaces` | Member of workspace | Via API only | Owner only | Owner only |
| `workspace_members` | Member of workspace | Owner (via invite) | Owner only | Owner only |
| `care_recipients` | Member of workspace | Owner only | Owner only | Owner only (soft) |
| `daily_reports` | Member of workspace | **Assigned caregiver OR workspace owner** | Contributor (own report, draft) | Denied |
| `report_entries` | Member of workspace | **Assigned caregiver OR workspace owner** (own report) | Contributor (own report, draft) | Contributor (own report, draft) |
| `incidents` | Member of workspace | Caregiver (assigned) | Caregiver (own, 1h window) | Denied |
| `parent_notes` | Caregiver/Owner (recipient) | Owner only | Owner (own note) | Owner (own, unseen) |
| `notifications` | Own notifications only | Service role only | Self (mark read) | Denied |
| `audit_logs` | Owner (own workspace) | Service role only | Denied | Denied |

**RLS example — `daily_reports` INSERT allowing both caregivers and owners:**

```sql
-- Caregivers: can only insert for recipients they are actively assigned to
CREATE POLICY "caregiver_can_insert_assigned"
  ON daily_reports FOR INSERT
  WITH CHECK (
    contributor_id = auth.uid()
    AND contributor_role = 'caregiver'
    AND EXISTS (
      SELECT 1 FROM caregiver_assignments ca
      WHERE ca.caregiver_id = auth.uid()
        AND ca.recipient_id = daily_reports.recipient_id
        AND ca.is_active = true
    )
  );

-- Owners: can insert for any recipient in their own workspace (no assignment needed)
CREATE POLICY "owner_can_insert_for_own_workspace"
  ON daily_reports FOR INSERT
  WITH CHECK (
    contributor_id = auth.uid()
    AND contributor_role = 'owner'
    AND get_my_workspace_role(workspace_id) = 'owner'
  );

-- Both caregivers and owners: can only update their own draft reports
CREATE POLICY "contributor_can_update_own_draft"
  ON daily_reports FOR UPDATE
  USING (
    contributor_id = auth.uid()
    AND status = 'draft'
  );
```

**Viewers cannot access `medical_notes` field:**

```sql
CREATE VIEW care_recipients_viewer AS
  SELECT id, workspace_id, full_name, display_name,
         date_of_birth, care_type, gender, photo_url, notes
    -- medical_notes intentionally excluded
  FROM care_recipients;
```

### 10.3 Free Tier DB-Level Enforcement

```sql
CREATE OR REPLACE FUNCTION check_free_tier_profile_limit()
RETURNS TRIGGER AS $$
BEGIN
  IF (
    SELECT plan FROM workspaces WHERE id = NEW.workspace_id
  ) = 'free' AND (
    SELECT COUNT(*) FROM care_recipients
    WHERE workspace_id = NEW.workspace_id AND is_active = true
  ) >= 2 THEN
    RAISE EXCEPTION 'FREE_TIER_LIMIT_EXCEEDED';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_free_tier_profile_limit
  BEFORE INSERT ON care_recipients
  FOR EACH ROW EXECUTE FUNCTION check_free_tier_profile_limit();
```

---

## 11. API Design

### 11.1 Architecture

CareLog uses **Supabase Edge Functions** (Deno/TypeScript) as the API layer. PostgREST handles simple reads where RLS fully controls access. Complex business logic lives in named Edge Functions.

Base URL: `https://<project>.supabase.co/functions/v1/`

All requests carry the Supabase JWT: `Authorization: Bearer <token>`

### 11.2 Endpoints by Domain

#### Workspaces

| Method | Path | Description |
|---|---|---|
| POST | `/workspaces` | Create workspace (auto-assigns owner role) |
| GET | `/workspaces/mine` | List caller's workspaces |
| GET | `/workspaces/:id` | Get workspace details |
| PATCH | `/workspaces/:id` | Update workspace settings (owner only) |

#### Members & Invitations

| Method | Path | Description |
|---|---|---|
| GET | `/workspaces/:id/members` | List all members |
| PATCH | `/workspaces/:id/members/:uid` | Update role (owner only) |
| DELETE | `/workspaces/:id/members/:uid` | Remove member (owner only) |
| POST | `/workspaces/:id/invitations` | Send invitation |
| GET | `/workspaces/:id/invitations` | List pending invitations |
| DELETE | `/workspaces/:id/invitations/:id` | Revoke invitation |
| POST | `/invitations/accept` | Accept invite by token (public) |

#### Care Recipients

| Method | Path | Description |
|---|---|---|
| GET | `/workspaces/:id/recipients` | List all recipients |
| POST | `/workspaces/:id/recipients` | Create recipient (owner only) |
| GET | `/workspaces/:id/recipients/:rid` | Get profile |
| PATCH | `/workspaces/:id/recipients/:rid` | Update (owner only) |
| DELETE | `/workspaces/:id/recipients/:rid` | Soft-delete (owner only) |

#### Shifts

| Method | Path | Description |
|---|---|---|
| POST | `/workspaces/:id/shifts/check-in` | Record shift start |
| POST | `/workspaces/:id/shifts/check-out` | Record shift end |
| GET | `/workspaces/:id/shifts` | List shifts (filterable by caregiver, date) |

#### Daily Reports

| Method | Path | Description |
|---|---|---|
| GET | `/workspaces/:id/reports` | List reports (filter: date, recipient, caregiver) |
| POST | `/workspaces/:id/reports` | Create draft report |
| GET | `/workspaces/:id/reports/:rid` | Get report with entries |
| PATCH | `/workspaces/:id/reports/:rid` | Update draft metadata |
| POST | `/workspaces/:id/reports/:rid/submit` | Submit report |
| POST | `/workspaces/:id/reports/:rid/acknowledge` | Acknowledge (owner) |

#### Report Entries

| Method | Path | Description |
|---|---|---|
| POST | `/workspaces/:id/reports/:rid/entries` | Add entry to draft |
| PATCH | `/workspaces/:id/reports/:rid/entries/:eid` | Edit entry (draft only) |
| DELETE | `/workspaces/:id/reports/:rid/entries/:eid` | Delete entry (draft only) |
| POST | `/workspaces/:id/reports/:rid/entries/:eid/photos` | Get signed upload URL |

#### Incidents

| Method | Path | Description |
|---|---|---|
| GET | `/workspaces/:id/incidents` | List incidents (filter: severity, date, recipient) |
| POST | `/workspaces/:id/incidents` | File incident report |
| GET | `/workspaces/:id/incidents/:iid` | Get incident detail |
| POST | `/workspaces/:id/incidents/:iid/acknowledge` | Acknowledge (owner) |

#### Notifications

| Method | Path | Description |
|---|---|---|
| GET | `/notifications` | List caller's notifications (paginated) |
| POST | `/notifications/:id/read` | Mark as read |
| POST | `/notifications/read-all` | Mark all as read |

### 11.3 Standard Response Envelope

```json
{
  "data": { ... },
  "error": null,
  "meta": { "page": 1, "page_size": 20, "total": 45 }
}
```

On error:
```json
{
  "data": null,
  "error": {
    "code": "REPORT_ALREADY_SUBMITTED",
    "message": "This report has already been submitted.",
    "status": 409
  }
}
```

### 11.4 Rate Limiting

| Tier | Limit | Window |
|---|---|---|
| Global per IP (unauthenticated) | 30 requests | 1 minute |
| Global per authenticated user | 120 requests | 1 minute |
| Report submission | 10 per caregiver | 1 hour |
| Photo upload | 20 per caregiver | 1 hour |
| Invitation send | 10 per workspace | 1 hour |
| Auth endpoints | 5 per IP | 15 minutes |

Implementation: Upstash Redis token-bucket via `@upstash/ratelimit`.

---

## 12. Mobile App Flows (Phase 2 Planning)

### 12.1 Caregiver App — Key Screens

| Screen | Purpose | Key Actions |
|---|---|---|
| **Home / Today** | Assigned recipients + today's report status | Tap to open/continue report |
| **Report Entry** | Active report for one recipient | Add entry by category; see parent notes |
| **Add Entry Modal** | Category-specific input form | Select category → fill chips → optional photo |
| **Camera / Photo Picker** | Capture or choose photo | Compress to ≤800KB; strip EXIF |
| **Submit Report** | Review all entries, set mood, add notes | Confirm + submit |
| **Incident Form** | File incident report | Severity → description → photos → submit |
| **Profile / Settings** | Name, notifications, language | Toggle push notifications |

### 12.2 Owner/Guardian App — Key Screens

| Screen | Purpose | Key Actions |
|---|---|---|
| **Dashboard** | Today's report status per recipient | Acknowledge, tap for detail |
| **Report Detail** | Full daily report with entries and photos | Acknowledge; leave a note |
| **Calendar View** | Browse reports by date | Navigate by month; tap date for report |
| **Recipient Profiles** | Manage care profiles | Add/edit/delete recipient |
| **Team Management** | Manage caregivers, assign to recipients | Send invite; revoke access |
| **Weekly Summary** | 7-day aggregate view (paid) | View charts; export PDF (Pro) |
| **Billing / Plan** | Current plan, usage, upgrade | Upgrade via Midtrans |

### 12.3 Offline-First Sync Strategy (React Native)

Uses **WatermelonDB** (SQLite-backed) synced with Supabase:

| Entity | Strategy | Conflict Resolution |
|---|---|---|
| `daily_reports` (draft) | Write locally → push on connectivity | Last-write-wins on draft; lock on submit |
| `report_entries` | Write locally → queue for push | Server timestamp wins; client queues retries |
| `care_recipients` | Pull-only; TTL 1 hour | Server always authoritative |
| `parent_notes` | Pull on app open + Realtime subscription | Read-only; immutable after create |
| `notifications` | Pull on app open + Realtime | Append-only; merge by `id` |

**Key rule:** Report **submission** requires connectivity. The UI blocks submit with a clear "No internet connection" state rather than queuing silently.

---

## 13. Web Admin Flows

### 13.1 Caregiver Daily Report Workflow

```
Login → Home Dashboard
  ↓
Select recipient from "My Assigned" list
  ↓
Check-in state check:
  ├─ Not checked in yet → "Start Shift" button
  └─ Checked in → Active shift badge (time elapsed)
  ↓
Handoff check (if another contributor already logged today):
  ├─ Banner: "Handoff from [Morning Nanny Name] — checked out at 15:00"
  │     Shows: summary counts ("3 meals · 1 nap · 2 diapers already logged")
  │     CTA: "Lihat Detail" → expands to show all previous entries
  └─ No prior entries → proceed directly
  ↓
Report card state (own entries only):
  ├─ Not started → "Start My Log"
  ├─ Draft in progress → "Continue My Log"
  └─ Submitted → Read-only view of own entries
  ↓
Report editing page:
  ├─ Parent notes panel (standing + today's) — pinned at top
  ├─ Entry feed: MERGED timeline (own entries + others), with contributor badges
  │     Own entries: white background, fully editable
  │     Other contributors' entries: gray background, read-only
  ├─ "+ Add Entry" → category picker → bottom sheet
  └─ Each own entry: edit inline | delete | attach photo
  ↓
Bottom bar: Mood selector (emoji 1–5) + handoff notes for next caregiver
  ↓
"Submit My Log" → confirmation modal → submit
  ↓
Post-submit: read-only view of own entries; merged timeline still visible
```

**Auto-save:** Drafts auto-save every 30 seconds. "Tersimpan" indicator in header.

### 13.2 Owner Dashboard Workflow

```
Login → Owner Dashboard
  ↓
Today's summary grid (one card per recipient):
  ├─ Contributor summary: "Bu Sari (morning) · Mbak Rina (night) · You"
  ├─ Overall status: "In Progress" if any contributor still on draft
  ├─ Entry count across ALL contributors ("5 meals · 3 sleeps · 4 diapers")
  └─ "View Full Timeline" CTA
  ↓
Unified report detail (all contributors merged):
  ├─ "Contributors today" pill row (tap to filter by contributor)
  ├─ Chronological timeline: ALL entries from ALL contributors
  │     Each entry shows: [category icon] [chips] [notes] [Contributor Name • Role badge] [time]
  ├─ Shift cards inline at check-in times
  ├─ Incidents section pinned at top (if any)
  ├─ "Add my own entry" button (owner logs care they personally provided)
  └─ "Acknowledge all" → marks all submitted reports as acknowledged

Owner logging own entries:
  ↓
"Add my own entry" → same bottom-sheet chip UI as caregiver
  ├─ Owner entries tagged with "Orang Tua" badge (purple)
  ├─ No check-in required; no shift tracking
  └─ Entry appears immediately in the unified timeline
```

### 13.3 Invitation Flow

```
Owner → Team → "Invite Member"
  ↓
Modal: email + role (Caregiver | Viewer)
  ↓
POST /workspaces/:id/invitations
  → Creates invitation record (token, 72h expiry)
  → Sends email via Resend
  → Shows in "Pending Invitations" table
  ↓
Invitee clicks link → /invite/accept?token=<token>
  ├─ Valid: sign in → auto-accept → join workspace
  └─ Expired/used: error page with "Request new invite" CTA
  ↓
On acceptance:
  → workspace_members record created
  → Owner notified: "[Name] accepted your invitation"
```

---

## 14. Notifications Architecture

### 14.1 Email Template Inventory

| Template ID | Trigger | Recipient |
|---|---|---|
| `invite_member` | Invitation created | Invitee |
| `report_submitted` | Report status → 'submitted' | All owners/viewers — **batched:** if ≥2 contributors submit for the same recipient within 30 minutes, one digest email is sent instead of multiple |
| `daily_eod_summary` | Cron: 20:00 WIB, if ≥1 report today | All owners |
| `incident_filed` | Incident submitted | All owners; opt-in viewers |
| `missing_report_alert` | Cron: 18:00 WIB, if no report started | Caregiver |
| `weekly_summary` | Cron: Sunday 08:00 WIB (paid) | All owners |
| `payment_receipt` | Subscription confirmed | Workspace owner |
| `plan_expiry_warning` | 7 days before expiry | Workspace owner |

**Email provider:** Resend (primary). All templates bilingual (Bahasa Indonesia / English based on user locale).

### 14.2 WhatsApp Deep Link Strategy

```
Invite caregiver:   https://wa.me/?text=Hai%2C+saya+mengundang+kamu...+{invite_url}
Share report:       https://wa.me/?text=Laporan+hari+ini+untuk+{child_name}%3A+{report_url}
Tell a friend:      https://wa.me/?text=Saya+pakai+CareLog...+{landing_url}
```

Every shareable link has Open Graph meta tags for rich WhatsApp previews.

### 14.3 Anti-Spam Rules

| Rule | Condition | Action |
|---|---|---|
| User unsubscribed from type | `notification_preferences.{type} = false` | Skip |
| Email bounce recorded | `user_email_status = 'bounced'` | Skip; flag account |
| Duplicate suppression | Same `(user_id, type, reference_id)` within 1 hour | Skip |
| EOD summary: no content | No reports submitted today | Skip for workspace |
| Daily rate cap | > 10 emails to any user in 24 hours | Queue for next day |

### 14.4 Push Notifications (Phase 2)

Uses Expo Notifications → APNs (iOS) / FCM (Android):

```
Supabase Database Webhook (on INSERT/UPDATE)
  → Edge Function: notification-dispatcher
    → Checks channel preference
    → For push: calls Expo Push API with device token
      → APNs / FCM
```

Android notification channels: `reports` (default), `alerts` (high importance for incidents), `system` (billing).

---

## 15. Reporting Architecture

### 15.1 Daily Report Flow

1. **Auto-create draft shell** when caregiver opens Today view for an assigned recipient with no report for that date (using `ON CONFLICT DO NOTHING`).
2. **Validate on submit:** at least 1 entry exists, mood is set, `report_date` is today or yesterday.
3. **Broadcast on submission:** Supabase Database Webhook fires `notification-dispatcher` Edge Function.

### 15.2 Weekly Summary Aggregation

Cron: Sunday 08:00 WIB (`cron-weekly-summary` Edge Function):
1. Query all active workspaces with ≥1 submitted report in the past 7 days.
2. Run per-category aggregation queries per recipient.
3. Store snapshot in `weekly_summaries` table (for future PDF export).
4. Send `weekly_summary` email to opted-in owners.

### 15.3 End-of-Day Email Digest

Cron: 20:00 WIB (`cron-eod-summary` Edge Function):
1. For each active workspace, find all recipients with submitted reports today.
2. If none: skip workspace (anti-spam).
3. Build summary payload with entry counts per category + mood + shift times.
4. Send one email per workspace (not one per recipient) to all owners.

### 15.4 Data Retention

| Data type | Retention | Action after |
|---|---|---|
| Reports (active workspace) | Indefinite | N/A |
| Report photos | 2 years hot storage | Move to cold (R2/S3 Glacier) |
| Audit logs | 3 years | Export to cold; purge from DB |
| Notifications | 90 days | Hard delete |
| Deleted workspace data | 30-day soft-delete grace | Hard delete |

Data export (UU PDP right to portability): Owner can request ZIP of all JSON + photos via `/settings/workspace/export` — generated asynchronously, download link sent via email.

---

## 16. Multi-Tenant SaaS Architecture

### 16.1 Workspace Isolation Model

Shared-database, workspace-scoped multi-tenancy. Isolation enforced at three layers:

1. **RLS layer** — Every query filtered by workspace membership. No cross-workspace data readable even with a valid JWT.
2. **API layer** — Edge Functions resolve `workspace_id` from verified JWT membership, never from request body.
3. **Storage layer** — Path prefix `workspaces/{workspace_id}/...`. Bucket policies mirror RLS.

### 16.2 Plan Configuration

```sql
CREATE TABLE plan_configs (
  plan              TEXT PRIMARY KEY,
  max_recipients    INT,       -- NULL = unlimited
  max_caregivers    INT,       -- NULL = unlimited
  history_days      INT,       -- NULL = unlimited
  storage_mb        INT,       -- NULL = unlimited
  max_backfill_days INT NOT NULL DEFAULT 1,
  features          JSONB NOT NULL DEFAULT '{}'
);

INSERT INTO plan_configs VALUES
  ('free',    2,    3,    7,    500,   1, '{"weekly_summary": false, "photo_gallery": false}'),
  ('starter', 5,    10,   90,   5120,  3, '{"weekly_summary": true, "photo_gallery": false}'),
  ('pro',     NULL, NULL, NULL, 20480, 7, '{"weekly_summary": true, "photo_gallery": true, "smart_reminders": true}');
```

### 16.3 Feature Gating

Three enforcement layers:
1. **DB:** `plan_configs.features` JSONB column checked in Edge Functions.
2. **API:** `assertFeature(workspaceId, feature)` guard in Edge Functions before processing.
3. **UI:** `WorkspaceContext` provides feature flags; non-available features show upgrade CTAs.

**Rule:** UI-level gating is cosmetic only. API and DB enforce the real gate.

### 16.4 Scalability Considerations

| Concern | Current Approach | Scale Trigger | Future Approach |
|---|---|---|---|
| DB connections | Supabase pooler (PgBouncer) | >500 concurrent | Read replicas for analytics |
| Report query performance | Composite indexes on (recipient_id, report_date) | >100k reports/workspace | Partition by workspace_id hash |
| Photo storage | Supabase Storage (S3-backed) | >1TB total | Lifecycle rules to R2/Glacier |
| Email sending | Resend | >10k workspaces | SendGrid volume pricing |
| Realtime subscriptions | Supabase Realtime | >1000 concurrent | Disable Realtime on Free plan |

---

## 17. Security Requirements

### 17.1 Authentication & Session Management

| Requirement | Implementation |
|---|---|
| Password policy | Min 8 chars, 1 uppercase, 1 number |
| Password hashing | bcrypt (Supabase Auth default, cost 10) |
| Session tokens | Short-lived JWT (1h) + refresh token (30 days) with rotation |
| Magic link expiry | 15 minutes, single-use |
| Session invalidation | On password change; manual revocation per device |
| Brute force protection | 10 failed attempts → 15-min lockout (Supabase Auth) |
| Bot detection on signup | Cloudflare Turnstile |

### 17.2 RLS Hardening Checklist

- [ ] All tables: `ALTER TABLE x ENABLE ROW LEVEL SECURITY;`
- [ ] All tables: `ALTER TABLE x FORCE ROW LEVEL SECURITY;`
- [ ] Service role key NEVER exposed to frontend or mobile
- [ ] Anonymous key scoped to invite acceptance only
- [ ] All policies tested with `SET LOCAL role = authenticated` in SQL tests

### 17.3 Photo & File Security

Upload flow:
1. Client compresses image to ≤800KB (Canvas API).
2. Client strips EXIF (exifr.js library).
3. Client requests signed upload URL from Edge Function.
4. Edge Function validates MIME type (whitelist: `image/jpeg`, `image/png`, `image/webp`) and size limit.
5. Client uploads directly to Supabase Storage via signed URL.
6. Server-side EXIF re-strip via `sharp` (defense in depth).

Access: All photos in private buckets. Signed URLs with 1-hour TTL, generated per request, never stored in DB.

### 17.4 UU PDP Compliance (Indonesian Data Protection Law)

| UU PDP Requirement | CareLog Implementation |
|---|---|
| Explicit consent | TOS + Privacy Policy accepted at signup; medical data has separate acknowledgment |
| Right to access | Data export within 24h of request |
| Right to erasure | Workspace deletion → 30-day grace → hard delete of all PII |
| Right to correction | Self-serve profile editing; report corrections via owner notes |
| Data minimization | `medical_notes` optional; minimal collection principle |
| Data localization | Supabase Singapore region (disclose in Privacy Policy) |
| Breach notification | 72-hour SLA; security@carelog.id monitored |
| Purpose limitation | No sale, no ad targeting; PostHog events are anonymized |

### 17.5 Audit Logging

Every state-changing action logged to `audit_logs` within the Edge Function (captures IP/user-agent from HTTP context). Audited actions include: member.invited, member.role_changed, member.removed, report.submitted, report.acknowledged, plan.upgraded, workspace.deleted.

### 17.6 Rate Limiting & Abuse Prevention

Uses Upstash Redis token-bucket (`@upstash/ratelimit`). Additional measures:

| Measure | Implementation |
|---|---|
| Workspace creation limit | Max 5 workspaces per user |
| Invitation spam | Max 10 pending invites per workspace; max 3 to same email/week |
| Account enumeration prevention | Generic auth error messages regardless of whether email exists |
| Anomalous bulk delete | Alert if >50 records deleted from any table in 5 minutes |
| WAF | Cloudflare WAF for edge blocking at the network layer |

---

## 18. Analytics & KPI Dashboard

### 18.1 North Star Metric

**Weekly Active Care Logs (WACL)** — number of days in a week where at least one care log entry was submitted per active workspace.

### 18.2 Key Product Metrics

| Layer | Metric | Definition | Target (Month 3) |
|---|---|---|---|
| Acquisition | Signups/week | New accounts registered | 200/week |
| Activation | Activation rate | Users who submit ≥1 report within 7 days | ≥ 55% |
| Retention | D30 retention | Users active 30 days after signup | ≥ 25% |
| Engagement | Owner view rate | Reports viewed by owner within 24h | ≥ 70% |
| Monetization | Free-to-paid CVR | Free users converting to paid within 30 days | ≥ 8% |
| Monetization | MRR | Monthly recurring revenue | Rp 15,000,000 |
| Retention | Monthly churn | Paid subscribers canceling per month | ≤ 5% |

### 18.3 Core Events to Track

All events carry base properties: `user_id`, `workspace_id`, `plan_tier`, `platform`, `locale`, `app_version`.

**Authentication & Onboarding:**

| Event | Properties |
|---|---|
| `user_signed_up` | `method` (magic_link/google), `referral_source` |
| `onboarding_step_completed` | `step` (welcome/create_profile/invite_caregiver) |
| `onboarding_completed` | `time_to_complete_seconds` |

**Core Report Events:**

| Event | Properties |
|---|---|
| `report_started` | `recipient_id`, `report_date` |
| `report_submitted` | `sections_count`, `photo_count`, `minutes_to_submit`, `report_type` |
| `report_viewed` | `viewer_role`, `report_age_hours`, `source` (notification/dashboard/direct) |
| `incident_filed` | `severity`, `incident_type` |
| `photo_uploaded` | `file_size_kb`, `upload_duration_ms` |
| `photo_upload_failed` | `error_type` |

**Monetization Events:**

| Event | Properties |
|---|---|
| `paywall_hit` | `limit_type` (profiles/history/feature), `current_usage` |
| `upgrade_page_viewed` | `source` |
| `subscription_started` | `plan`, `billing_cycle`, `amount_idr` |
| `subscription_canceled` | `plan`, `reason`, `days_active` |

### 18.4 Key Funnels

1. **Parent onboarding:** Landing page → signup → create profile → invite caregiver → first report received
2. **Caregiver activation:** Invite link clicked → signup → first report submitted
3. **Daily loop:** Report form opened → sections filled → submitted → parent viewed → parent reacted
4. **Viral loop:** Report viewed → WhatsApp share clicked → new user signed up

### 18.5 PostHog Dashboard Setup

- **Dashboard 1 — Growth Funnel:** Signup → onboarding → first report → subscription funnel with conversion rates by platform and locale
- **Dashboard 2 — Engagement Health:** Daily WACL trend, owner view rate (7-day rolling), photo attachment rate, notification CTR by channel
- **Dashboard 3 — Monetization:** MRR trend, paywall hit by limit type, upgrade funnel, churn cohorts
- **Dashboard 4 — Technical Health:** `photo_upload_failed` rate by error type, abandoned drafts rate, API error rate

**Tracking rules:** Never track PII in events (no names, emails, photos in properties). Respect `Do Not Track` browser setting. PostHog anonymized (no personal data sent).

---

## 19. Release Plan

### 19.1 Phase Overview

```
Phase 1: Foundation       Weeks  1–4   (MVP core)
Phase 2: Engagement       Weeks  5–8   (Notifications, sharing)
Phase 3: Polish & Seed    Weeks  9–12  (Reminders, SEO, beta)
Phase 4: Growth           Months 4–6   (P1 features, PWA)
Phase 5: Scale            Months 7–12  (Native apps, AI, org accounts)
```

### 19.2 Phase 1 — Foundation (Weeks 1–4)

**Week 1: Infrastructure & Auth**
- Supabase project init: DB schema, RLS policies, Auth config
- Next.js scaffolding: App Router, TypeScript strict, Tailwind CSS
- CI/CD: GitHub Actions → Vercel preview + production
- Auth pages: magic link, Google OAuth, logout
- PostHog SDK integration

**Week 2: Workspace & Profile Setup**
- Workspace creation flow + owner onboarding
- Care recipient profile CRUD
- Supabase Storage bucket (RLS-protected)
- Caregiver invite system (signed token, accept flow)

**Week 3: Shift Tracking + Report Form**
- Shift check-in/check-out
- Daily report form: Mode 1 (Quick Tap), all P0 log categories
- Form auto-save to localStorage

**Week 4: Report Viewing + Tier Enforcement**
- Owner dashboard + report detail view
- 7-day history limit for free tier
- 1-profile limit for free tier (DB trigger + paywall modal)
- Resend email: signup confirmation

### 19.3 Phase 2 — Engagement (Weeks 5–8)

- **Week 5:** Incident reporting form, severity, immediate email/push notification
- **Week 6:** Mode 2 (Backfill) + Mode 3 (Quick Summary), parent standing + daily instructions
- **Week 7:** Email notification system (report submitted, daily digest), in-app notification center
- **Week 8:** WhatsApp deep link sharing (invite, report share); Supabase Realtime for live badge updates

### 19.4 Phase 3 — Polish & Seed (Weeks 9–12)

- **Week 9:** Caregiver daily reminder email (5 PM WIB); Midtrans payment integration placeholder
- **Week 10:** Bilingual i18n complete (all P0 strings reviewed by human translator); Lighthouse CI gate (≥85)
- **Week 11:** Full QA: cross-device, accessibility audit (axe-core), performance validation
- **Week 12:** Beta launch with 50 pilot households in Jakarta; feedback widget (PostHog surveys)

### 19.5 Critical Path & Dependencies

```
[Supabase Schema + RLS] → [Auth] → [Workspace + Profiles]
  → [Report Form] → [Report Viewing] → [Free Tier Enforcement]
    → [Beta Launch]

Parallel tracks (independent after Week 2):
  A: Notifications (email → realtime → push)
  B: Sharing (WhatsApp deep links)
  C: SEO + i18n
  D: Payments (start Midtrans account approval in Week 6 — allow 2 weeks)
```

**Hard dependencies:**
- Midtrans business account approval: 1–2 weeks — start in Week 6.
- Resend domain verification: DNS access needed — Week 1.
- Human translation review (Bahasa Indonesia): must run in parallel with development.

### 19.6 Team Structure

| Role | Headcount | Phases |
|---|---|---|
| Full-Stack Engineer (Lead) | 1 | All |
| Full-Stack Engineer | 1 | All |
| Frontend Engineer | 1 | Phase 2+ |
| UI/UX Designer | 1 | All |
| QA Engineer | 1 | Phase 3+ |
| Product Manager | 1 | All |

---

## 20. Technical Architecture Diagram

### 20.1 System Components

```
┌──────────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER                             │
│                                                                  │
│  ┌──────────────────────┐    ┌──────────────────────────────┐   │
│  │   Browser (Web)      │    │   PWA (Add to Home Screen)   │   │
│  │   Next.js App        │    │   Service Worker + Cache     │   │
│  │   React + Tailwind   │    │   IndexedDB (offline drafts) │   │
│  └──────────┬───────────┘    └──────────────┬───────────────┘   │
└─────────────┼────────────────────────────────┼──────────────────┘
              │ HTTPS                          │ HTTPS
              ▼                                ▼
┌──────────────────────────────────────────────────────────────────┐
│                    VERCEL EDGE NETWORK (sin1)                    │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                  Next.js Application                       │  │
│  │                                                            │  │
│  │  ┌─────────────┐  ┌─────────────────┐  ┌──────────────┐  │  │
│  │  │ App Router  │  │  API Routes     │  │  Middleware  │  │  │
│  │  │ (RSC + CSR) │  │  /api/v1/*      │  │  (auth,      │  │  │
│  │  │             │  │                 │  │   i18n,      │  │  │
│  │  │             │  │                 │  │   rate limit)│  │  │
│  │  └─────────────┘  └────────┬────────┘  └──────────────┘  │  │
│  └───────────────────────────┼────────────────────────────────┘  │
└──────────────────────────────┼──────────────────────────────────┘
                               │
          ┌────────────────────┼────────────────────────┐
          │                   │                        │
          ▼                   ▼                        ▼
┌──────────────────┐ ┌─────────────────────┐ ┌─────────────────────┐
│  SUPABASE        │ │  THIRD-PARTY        │ │  ANALYTICS          │
│  (ap-southeast-1)│ │  SERVICES           │ │                     │
│                  │ │                     │ │  ┌───────────────┐  │
│  ┌────────────┐  │ │  ┌───────────────┐  │ │  │ PostHog       │  │
│  │ PostgreSQL │  │ │  │ Resend        │  │ │  │ (self-hosted  │  │
│  │ (RLS-gated)│  │ │  │ (Email)       │  │ │  │  or cloud)    │  │
│  └────────────┘  │ │  └───────────────┘  │ │  └───────────────┘  │
│  ┌────────────┐  │ │  ┌───────────────┐  │ └─────────────────────┘
│  │ Auth       │  │ │  │ Midtrans      │  │
│  │ (JWT/Magic │  │ │  │ (Payments IDR)│  │
│  │  Link/OAuth│  │ │  └───────────────┘  │
│  └────────────┘  │ │  ┌───────────────┐  │
│  ┌────────────┐  │ │  │ WhatsApp      │  │
│  │ Storage    │  │ │  │ (wa.me deep   │  │
│  │ (Photos,   │  │ │  │  links)       │  │
│  │  Files)    │  │ │  └───────────────┘  │
│  └────────────┘  │ └─────────────────────┘
│  ┌────────────┐  │
│  │ Realtime   │  │
│  │ (WebSocket)│  │
│  └────────────┘  │
│  ┌────────────┐  │
│  │ Edge       │  │
│  │ Functions  │  │
│  │ (Deno)     │  │
│  └────────────┘  │
└──────────────────┘
```

### 20.2 Data Flow: Caregiver Submit → Parent Notification

```
[1] Browser: Form validation (client-side, Zod)
[2] Next.js API Route: POST /api/v1/reports/:id/submit
    - Verify JWT (Supabase Auth middleware)
    - Validate payload (server Zod)
    - Check duplicate report
    - Check free tier limits
[3] If photos: client uploads to Supabase Storage via signed URL
    → Returns CDN URL
[4] Supabase PostgreSQL: UPDATE daily_reports SET status='submitted'
    → RLS policy verifies caregiver is assigned to recipient
[5] Supabase Realtime CDC → broadcasts to owner browser
    → In-app notification badge updates immediately
[6] Supabase Database Webhook → Edge Function: notification-dispatcher
    (async, does not block API response)
[6a] Resend API → renders bilingual email → sends to owner
[6b] PostHog Server SDK → captures report_submitted event
[7] Owner receives email with summary + deep link
[8] Owner clicks link → report detail → PostHog captures report_viewed
```

---

## 21. Risks & Edge Cases

### 21.1 Product Risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Caregivers resist digital tools | High | Critical | <5 min to first log from invite; Bahasa Indonesia default; offline drafts; involve caregivers in beta |
| Owners don't view reports | Medium | High | Push email within 5 min of submit; weekly digest; reaction feature for positive reinforcement |
| Seasonal churn (post-Lebaran caregiver turnover) | High | Medium | Re-onboarding new caregiver frictionless; workspace history persists independent of caregiver |
| Competitors copy features | High | Medium | Build network effect (shared workspace data); invest in AI features with data moat |

### 21.2 Technical Risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Supabase Realtime instability | Medium | Medium | Polling fallback (60s); degrade gracefully to email-only |
| Photo storage cost growth | High | Medium | Client-side compression; WebP conversion; per-workspace quotas; alert at 80% |
| PostgreSQL performance at scale | Low (MVP) | High | Composite indexes; partition `daily_reports` by `workspace_id` when >10M rows |
| Midtrans webhook reliability | Medium | High | Idempotent handler; daily reconciliation cron to verify subscription status |

### 21.3 Edge Cases by Feature

#### Multi-Contributor Scenario: Multiple Caregivers + Owner Logging on the Same Day

**Scenario:** Baby has a morning nanny (shift 07:00–15:00), a night nanny (shift 15:00–23:00), and the mother also logs the evening bath and bedtime feed herself.

**Design decision:** Each contributor (morning nanny, night nanny, owner) gets their own `daily_reports` row keyed by `(recipient_id, report_date, contributor_id)`. All three sets of entries are merged into a single unified timeline for the owner's view.

```sql
-- Unique constraint: one report per (recipient, date, contributor)
ALTER TABLE daily_reports
  ADD CONSTRAINT uq_report_recipient_date_contributor
  UNIQUE (recipient_id, report_date, contributor_id);
```

**Same contributor submits twice:** `HTTP 409` — "Sudah ada laporan untuk hari ini. Edit laporan yang ada?" — redirect to edit the existing draft.

**What each contributor can see:**
- Each caregiver can read all entries from all contributors for the same recipient on the same day (RPT-005).
- Each caregiver can only edit/delete their own entries.
- Owner can read all entries and also add their own.

**Owner notification batching:** If both caregivers submit within 30 minutes, the owner receives ONE digest email listing both contributors' summaries — not two separate emails.

**Unified timeline merge query (simplified):**
```sql
SELECT re.*, dr.contributor_id, dr.contributor_role,
       p.full_name AS contributor_name
FROM report_entries re
JOIN daily_reports dr ON dr.id = re.report_id
JOIN profiles p ON p.user_id = dr.contributor_id
WHERE dr.recipient_id = $1
  AND dr.report_date = $2
  AND dr.workspace_id = $3
ORDER BY re.occurred_at ASC;
```

#### Timezone Handling (WIB / WITA / WIT)

- `report_date` stored as `DATE` (no timezone), not `TIMESTAMPTZ`.
- Client sends local calendar date via `Intl.DateTimeFormat`.
- `submitted_at` stored as UTC for audit.
- "Reports due today" queries use workspace timezone:

```sql
WHERE report_date = (NOW() AT TIME ZONE workspace.timezone)::DATE
```

#### Deleted Caregiver Access to Historical Reports

- Reports are workspace-owned. `caregiver_id` is informational.
- On removal: caregiver loses workspace access via RLS immediately.
- Historical reports retained intact; displayed to owner with "[Name] (removed)" label.

#### Network Failure During Photo Upload

- Photos uploaded independently and in parallel.
- Each tracked in component state: `{ status: 'pending' | 'uploading' | 'success' | 'error' }`.
- Failed uploads: individual retry button, max 3 auto-retries with exponential backoff.
- Submit button remains enabled — caregiver can submit without failed photos.
- Succeeded photos' CDN URLs preserved across retries.

#### Invitation Link Abuse

- 32-byte cryptographically random tokens.
- Single-use: `accepted_at = NOW()` invalidates token.
- 72-hour expiry enforced at DB level.
- Rate limit: 10 acceptance attempts per IP per hour.
- Owner email notification on every acceptance.

#### Free Tier Race Condition (Two Tabs Creating Second Profile)

- DB trigger enforces limit (see Section 10.3) — only one request can succeed regardless of concurrency.
- API catches `FREE_TIER_LIMIT_EXCEEDED` exception, returns `HTTP 402` with upgrade CTA.
- Client-side check is UX convenience only — never relied upon for enforcement.

#### Offline Draft Conflicts with Server State

- Drafts have `last_modified_at` (millisecond precision, set on device).
- On sync: client sends draft with `last_modified_at`.
- Server compares against `care_reports.updated_at`.
- If conflict detected: `HTTP 409` with server version in response.
- UI presents conflict resolution: "Local version vs. Server version" with diff and [Use Local] / [Use Server] / [Merge] options.

---

## 22. Acceptance Criteria Summary

### 22.1 P0 Features — Consolidated Acceptance Criteria

| Feature | Acceptance Criteria |
|---|---|
| **User Registration** | (1) Email magic link creates account within 60s. (2) Confirmation email sent. (3) Duplicate email returns clear error. (4) Password min 8 chars enforced client + server. |
| **User Login** | (1) Valid credentials return session and redirect to dashboard. (2) Invalid credentials show generic error (no field enumeration). (3) Session persists across refresh. (4) Logout clears session. |
| **Workspace Creation** | (1) Owner creates workspace with name. (2) Owner auto-assigned Owner role. (3) Free tier: `plan = 'free'`. |
| **Care Recipient Profile** | (1) Fields: name (required), DOB (required), care type (required), photo (optional), medical notes (optional). (2) Free tier: second profile blocked with upgrade modal. (3) Profile photo served from CDN. |
| **Caregiver Invite** | (1) Owner generates invite link. (2) Expires 72h, single-use. (3) Accepting creates `workspace_members` record. (4) Owner email notification on acceptance. |
| **Multi-Caregiver Assignment** | (1) Owner can assign multiple caregivers to one care recipient. (2) Owner can assign one caregiver to multiple recipients. (3) Assignment done from care profile screen. (4) Each recipient shows list of assigned caregivers. (5) Free tier: max 3 caregivers per workspace. |
| **Caregiver Revocation** | (1) Owner can revoke caregiver access to specific child or entire workspace. (2) Revocation takes effect within 5 seconds across all sessions. (3) Revoked caregiver sees "access removed" message. (4) Historical logs by revoked caregiver are retained. (5) Confirmation dialog before revoking. |
| **Shift Check-In** | (1) One-tap from home screen. (2) Timestamp recorded (UTC). (3) Visible to owner in real time. (4) Soft block on logging before check-in with override. |
| **Shift Check-Out** | (1) One-tap when shift active. (2) Shift duration calculated. (3) Caregiver retains read access post-checkout. |
| **Report Submission (Mode 1)** | (1) Category buttons ≥56×56px. (2) Bottom sheet opens on tap. (3) All inputs are chips — zero required typing. (4) Entry appears on timeline within 2s. (5) Auto-save every 30s. |
| **Report Submission (Mode 3)** | (1) Triggered after 4 PM if timeline empty. (2) Count-based UI completable in <30s. (3) Labeled "Ringkasan" in parent view. |
| **Incident Reporting** | (1) Red button always visible, 1-tap accessible. (2) Required: type, severity, time, description (min 20 chars). (3) Owner notification <60s. (4) Emergency severity shows pulsing badge. |
| **Photo Upload** | (1) Up to 5 photos per incident, 20 per report. (2) Max 5 MB per photo. (3) Failed upload shows per-photo retry. (4) Photos served from CDN. |
| **Report Viewing** | (1) Chronological timeline with category icons, chips, notes, caregiver name. (2) Incidents section at top. (3) Shift summary card included. (4) `report_viewed` PostHog event fires. |
| **7-Day History Limit (Free)** | (1) Reports >7 days hidden on free tier. (2) Upgrade prompt shown. (3) Upgrading immediately reveals full history. |
| **14-Day Free Trial** | (1) New accounts auto-start Pro trial. (2) No payment required. (3) Day 10 + Day 13 reminder emails. (4) Day 15: drops to Free tier. (5) One trial per account. (6) No data deleted on downgrade. |
| **Subscription Checkout** | (1) Midtrans Snap opens in-app. (2) Supports QRIS, GoPay, OVO, DANA, ShopeePay, VA, Alfamart/Indomaret, cards. (3) Activates within 30 seconds. (4) Confirmation email with receipt. |
| **Subscription Management** | (1) Settings shows plan, cycle, renewal date, payment method. (2) Can switch monthly↔annual (prorated). (3) Cancel stops future charges, access until period end. (4) 3-day grace period on failed payment. |
| **Daily Email Digest** | (1) Owner email at 17:00 WIB with entry summary. (2) Caregiver reminder at 17:00 WIB if no entries logged. (3) Delivered within ±5 minutes of scheduled time. |
| **Parent Instructions** | (1) Standing notes visible every day; daily notes visible on specified date only. (2) Pinned above quick-action buttons. (3) Visually distinct styling. (4) Cached locally for offline access. |
| **Bilingual UI** | (1) All P0 strings in ID and EN (human-translated). (2) Language toggle in settings, instant effect. (3) Default: Bahasa Indonesia. |
| **Free Tier Enforcement (Race Condition)** | (1) Concurrent profile creation: only one succeeds. (2) DB trigger raises exception for second request. (3) Both responses correct (no silent duplicate). |

### 22.2 Definition of Done — MVP Launch

A feature is **done** when:
- [ ] All acceptance criteria pass
- [ ] Unit tests written and passing (≥80% coverage on core modules)
- [ ] Integration tests cover primary happy path
- [ ] No open P0 or P1 bugs
- [ ] Tested on: Chrome Android (latest), Safari iOS 16+, Samsung Internet, Chrome desktop
- [ ] Tested at: 4G, 3G throttled, offline (where applicable)
- [ ] All UI strings in both `id` and `en` locale files
- [ ] WCAG 2.1 AA audit passed (axe-core in CI)
- [ ] Lighthouse CI score ≥85: Performance, Accessibility, Best Practices
- [ ] No secrets, PII, or internal errors exposed in API responses
- [ ] PostHog events verified in debug mode
- [ ] Product Manager sign-off

**MVP launch is ready when:**
- All P0 features meet Definition of Done
- 50+ beta users with ≥1 week usage without data loss incidents
- Sentry error rate <0.1% of sessions
- P99 API response time <800ms under 100 concurrent users

### 22.3 Performance Budgets

| Metric | Target | Method |
|---|---|---|
| LCP | < 2.5s (4G mobile) | Lighthouse CI |
| INP | < 100ms | Web Vitals library |
| CLS | < 0.1 | Lighthouse CI |
| TTI | < 4.0s (4G mobile) | Lighthouse CI |
| API response (P50) | < 200ms | Vercel Analytics |
| API response (P99) | < 800ms | k6 load test (100 concurrent) |
| Photo upload (1MB, 4G) | < 5s | Manual QA on Redmi 12C |
| JS bundle (initial) | < 200KB gzipped | `next build` analyzer |

### 22.4 QA Test Matrix (Key Scenarios)

| Feature | Test Case | Type | Expected |
|---|---|---|---|
| Auth | Sign up with valid email | Happy path | Account created, confirmation email sent |
| Auth | Sign up with existing email | Edge case | `HTTP 400`, "Email already in use" |
| Auth | Magic link expired (>15 min) | Edge case | Error with resend option |
| Report | Submit complete report | Happy path | Saved, confirmed, owner notified |
| Report | Submit duplicate (same recipient, date, caregiver) | Edge case | `HTTP 409`, offer to edit |
| Report | Submit offline → reconnect | Edge case | Draft synced, submitted automatically |
| Report | Upload photo + network dropout | Edge case | Per-photo retry; other photos unaffected |
| Report | WITA caregiver reports at 11:45 PM | Edge case | `report_date` = local date, not UTC+1 |
| Incident | File Emergency severity incident | Happy path | Owner notification <60s, pulsing badge |
| Free tier | Add second profile on free plan | Edge case | Blocked with upgrade modal |
| Free tier | Concurrent second profile (two tabs) | Edge case | Only one succeeds; both UIs correct |
| Free tier | Owner views 8-day-old report | Edge case | Hidden with upgrade prompt |
| Invite | Accept expired invite (>72h) | Edge case | `HTTP 410`, "Invite has expired" |
| Invite | Accept already-used invite | Edge case | `HTTP 410`, "Invite already used" |
| Notifications | Report submitted → owner email | Happy path | Received within 120s |
| Notifications | Notifications disabled by owner | Edge case | No email sent |

---

## 23. UX Design Notes

*[FIGMA NEEDED: All P0 screen designs required before engineering kickoff in Week 1]*

### 23.1 Core UX Principles

- **Tap, don't type.** Every caregiver interaction is chip/button-based. Text fields exist only as optional notes.
- **Bu Sari test.** Every caregiver screen must be completable in 3 taps or fewer with Bahasa Indonesia text and no ambiguous icons.
- **One primary action per screen.** No decision paralysis. Clear visual hierarchy.
- **Confirm every important action.** "Laporan berhasil dikirim!" (Report sent!) with green checkmark after each submit.
- **Specific error messages.** "Foto gagal diunggah — ketuk untuk coba lagi" — never generic "Something went wrong".

### 23.2 Required UX States for Every Interactive Feature

| State | Required Treatment |
|---|---|
| **Default** | Clear primary action visible without scrolling |
| **Loading** | Skeleton screens (not spinners) for content; spinner only for point-in-time actions |
| **Empty** | Helpful illustration + specific action prompt (never blank) |
| **Error** | Inline, specific, actionable message in Bahasa Indonesia / English |
| **Success** | Confirmation with green checkmark; auto-dismiss after 3 seconds |
| **Disabled** | Gray with reason text; minimum contrast still readable |
| **Offline** | Yellow banner: "Tersimpan offline — akan dikirim saat terhubung" |

### 23.3 Missing UX Specifications (To Be Resolved Before Engineering)

| Feature | Missing Spec | Suggested |
|---|---|---|
| Incident form | Animation for "Emergency" severity selection | Haptic feedback + pulsing red visual |
| Mode switching (1/2/3) | Transition when switching from Mode 1 to Mode 3 | Smooth bottom sheet slide-up |
| Photo upload progress | Progress indicator during upload | Per-photo percentage bar |
| Shift check-in confirmation | Visual feedback for successful check-in | Full-screen green flash + timestamp |
| Parent instructions | Behavior when standing + daily notes both present | Standing pinned above, daily note below with calendar icon |
| Notification bell animation | Badge appearance on new notification | Pulse animation, respect `prefers-reduced-motion` |
| Paywall modal | Upgrade CTA design for free tier limit hit | Feature comparison + Midtrans checkout entry |
| Timezone display | Where is WIB timezone shown to users in multiple timezones | Workspace timezone indicator on report timestamps |
| **Multi-contributor timeline** | [FIGMA NEEDED] How contributor attribution looks inline on each entry | Avatar initial + name chip + role color badge per entry |
| **Handoff banner** | [FIGMA NEEDED] Design for incoming caregiver's handoff context banner | Yellow dismissible banner, expandable, shows prior entries summary |
| **Owner "Add my entry" CTA** | [FIGMA NEEDED] How owner accesses the logging UI from report detail view | Floating "+" button that opens same bottom-sheet chip UI as caregiver |
| **"Contributors today" pill row** | [FIGMA NEEDED] Horizontal scrollable chips showing all contributors for the day | Color-coded chips: tap to filter timeline to one contributor |

### 23.4 Responsive Behavior

| Feature | Mobile (360–767px) | Tablet/Desktop (≥768px) |
|---|---|---|
| Category buttons | 2×3 grid, 56×56px minimum | Horizontal row, larger |
| Bottom sheet | Full-width, slides up from bottom | Centered modal, max 480px |
| Report timeline | Single column, full-width cards | Two-column: timeline left, detail right |
| Owner dashboard | Stack of recipient cards | Grid layout 2–3 columns |
| Parent notes | Collapsed accordion, expand on tap | Persistent sidebar on report form |

### 23.5 Accessibility Requirements

- All color severity indicators (Low/Medium/High/Emergency) include text labels — color alone is insufficient.
- All images require `alt` text.
- All form fields require associated `<label>` elements.
- Focus rings visible (`focus-visible` CSS pseudo-class).
- Tab order matches visual reading order (top-to-bottom, left-to-right).
- Emoji mood selectors require `aria-label` (e.g., `aria-label="Happy"`).
- `prefers-reduced-motion` respected — no auto-playing animations for users who opt out.

---

## 24. SEO Requirements

### 24.1 Crawlability

CareLog is a web app. The marketing/landing pages must be server-rendered (Next.js SSG/ISR). The app itself is behind authentication and intentionally not indexed.

| Page | Rendering Strategy | Indexed? |
|---|---|---|
| `/` (landing page) | SSG | Yes |
| `/pricing` | SSG | Yes |
| `/blog/*` | ISR (if created) | Yes |
| `/app/*` (all authenticated routes) | CSR / SSR | No (`noindex`) |
| `/invite/accept` | SSR (dynamic token) | No (`noindex`) |

`robots.txt` must explicitly disallow `/app/`, `/api/`, `/invite/`.

### 24.2 Structured Data (Schema.org)

| Page | Schema type | Key fields |
|---|---|---|
| Landing page | `SoftwareApplication` | `name`, `description`, `applicationCategory: HealthApplication`, `offers` (pricing), `availableLanguage: ["id", "en"]` |
| Pricing page | `Product` + `Offer` | Name, price (IDR), priceCurrency, priceValidUntil |
| FAQ section | `FAQPage` | Q&A structured data for common questions |

### 24.3 Core Web Vitals Requirements

| Metric | Target | Enforcement |
|---|---|---|
| LCP (landing page) | < 2.5s on mobile | Lighthouse CI gate on every PR |
| CLS | < 0.1 | Reserve image dimensions in HTML; no layout-shifting ads |
| INP | < 200ms | Avoid heavy hydration on landing page; defer non-critical JS |

### 24.4 Meta Tags & On-Page SEO

All public pages must define:

```tsx
// Next.js Metadata API (app/layout.tsx or per-page)
export const metadata: Metadata = {
  title: "CareLog — Laporan Harian Pengasuh Anak | Daily Care Report",
  description: "Ganti rantai WhatsApp harian dengan laporan perawatan terstruktur...",
  openGraph: {
    type: "website",
    locale: "id_ID",
    alternateLocale: "en_US",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
  twitter: { card: "summary_large_image" },
};
```

### 24.5 i18n SEO

- URL structure: `/id/` prefix for Bahasa Indonesia, `/en/` for English (or `lang` query param as fallback).
- `hreflang` tags for `id` and `en` on all public pages.
- Translated meta title and description for both locales.
- Open Graph `locale` tag: `id_ID` vs `en_US`.

### 24.6 SEO Requirements for WhatsApp Share Links

All shareable report links must include:

```html
<meta property="og:title" content="Laporan Harian Rara — CareLog" />
<meta property="og:description" content="3 meals · 2 naps · Vitamins: taken · Mood: 😊" />
<meta property="og:image" content="https://app.carelog.id/api/og/report?id=..." />
```

Dynamic OG images via Vercel OG (Next.js `ImageResponse`) for rich WhatsApp link previews.

---

## 25. Appendix: Auto-Review Summary

| Persona | Items Added | Key Additions |
|---|---|---|
| **Product Manager** | 9 | Executive summary, detailed problem framing, 3 personas, prioritized user stories table (P0/P1/P2), MVP scope with explicit out-of-scope list, Phase 1/2 roadmap with timeline estimates, NFRs with measurable targets |
| **UI/UX Designer** | 8 | "Bu Sari test" usability rule, 3-mode UX input system codified as requirements, 8-state UI model (default/loading/empty/error/success/disabled/offline), responsive breakpoint specs, missing UX spec table, accessibility requirements with specific ARIA guidance |
| **SEO Specialist** | 6 | SSG/ISR vs. CSR rendering strategy per page type, Schema.org markup requirements (SoftwareApplication, FAQPage, Offer), Lighthouse CI gate as PR requirement, hreflang for ID/EN, dynamic OG image spec for WhatsApp share previews, robots.txt disallow rules for authenticated routes |

### Placeholders to Resolve Before Engineering Kickoff

| Placeholder | Location | Owner |
|---|---|---|
| `[DATA NEEDED]` — Indonesian households with caregivers | Section 2.3 | Growth / Research |
| `[DATA NEEDED]` — Business goals metrics (MAW, MRR targets) | Section 3.2 | Product / Finance |
| `[DATA NEEDED]` — Beta NPS threshold for go/no-go | Section 8.4 | Product |
| `[FIGMA NEEDED]` — All P0 screen designs | Section 23 | UI/UX Designer |
| `[FIGMA NEEDED]` — Incident form UX with severity animations | Section 23.3 | UI/UX Designer |
| `[FIGMA NEEDED]` — Paywall modal design | Section 23.3 | UI/UX Designer |
| `[LEGAL REVIEW]` — UU PDP children's data consent mechanism | Section 17.4 | Legal Counsel |
| `[LEGAL REVIEW]` — Privacy Policy and TOS (ID + EN) | Section 17.4 | Legal Counsel |
| `[INFRA]` — Resend domain verification (DNS access) | Section 19.5 | Engineering |
| `[INFRA]` — Midtrans business account registration | Section 19.5 | Engineering / Finance |

---

*This is a living document. Last updated: June 26, 2026.*
*Strategy: Indonesia-first, international-ready.*
*Architecture: Web-first MVP → PWA → Native Mobile (Phase 2).*
