// Package domain holds the shared vocabulary of CareLog: the enumerated values
// that appear in database CHECK constraints, API payloads and UI labels.
//
// This file is the single source of truth. The TypeScript mirror consumed by the
// web app is rendered from these values by cmd/gen-constants — never edit that
// file by hand, and run `make generate` after changing anything here.
//
//go:generate go run ../../cmd/gen-constants -out ../../web/src/lib/constants.generated.ts
package domain

// Role is a member's role within a workspace. It governs authorization for every
// workspace-scoped request (RFC §8.6).
type Role string

const (
	RoleOwner     Role = "owner"
	RoleCaregiver Role = "caregiver"
	RoleViewer    Role = "viewer"
)

// Roles lists every valid Role in display order.
var Roles = []Role{RoleOwner, RoleCaregiver, RoleViewer}

func (r Role) String() string { return string(r) }

// IsValidRole reports whether s names a known role.
func IsValidRole(s string) bool { return isValid(Roles, s) }

// CareType describes the kind of care a recipient receives.
type CareType string

const (
	CareTypeChild   CareType = "child"
	CareTypeInfant  CareType = "infant"
	CareTypeElderly CareType = "elderly"
	CareTypePatient CareType = "patient"
)

// CareTypes lists every valid CareType in display order.
var CareTypes = []CareType{CareTypeChild, CareTypeInfant, CareTypeElderly, CareTypePatient}

func (c CareType) String() string { return string(c) }

// IsValidCareType reports whether s names a known care type.
func IsValidCareType(s string) bool { return isValid(CareTypes, s) }

// LogCategory is the category of a single report entry.
type LogCategory string

const (
	LogCategoryMeal       LogCategory = "meal"
	LogCategorySleep      LogCategory = "sleep"
	LogCategoryDiaper     LogCategory = "diaper"
	LogCategoryMedication LogCategory = "medication"
	LogCategoryActivity   LogCategory = "activity"
	LogCategoryMood       LogCategory = "mood"
	LogCategoryHealth     LogCategory = "health"
	LogCategoryLearning   LogCategory = "learning"
	LogCategoryTherapy    LogCategory = "therapy"
	LogCategoryNote       LogCategory = "note"
	LogCategoryOther      LogCategory = "other"
)

// LogCategories lists every valid LogCategory in display order.
var LogCategories = []LogCategory{
	LogCategoryMeal, LogCategorySleep, LogCategoryDiaper, LogCategoryMedication,
	LogCategoryActivity, LogCategoryMood, LogCategoryHealth, LogCategoryLearning,
	LogCategoryTherapy, LogCategoryNote, LogCategoryOther,
}

func (c LogCategory) String() string { return string(c) }

// IsValidLogCategory reports whether s names a known log category.
func IsValidLogCategory(s string) bool { return isValid(LogCategories, s) }

// IncidentType classifies a reported incident.
type IncidentType string

const (
	IncidentTypeFall          IncidentType = "fall"
	IncidentTypeInjury        IncidentType = "injury"
	IncidentTypeMedical       IncidentType = "medical"
	IncidentTypeBehavioral    IncidentType = "behavioral"
	IncidentTypeEnvironmental IncidentType = "environmental"
	IncidentTypeOther         IncidentType = "other"
)

// IncidentTypes lists every valid IncidentType in display order.
var IncidentTypes = []IncidentType{
	IncidentTypeFall, IncidentTypeInjury, IncidentTypeMedical,
	IncidentTypeBehavioral, IncidentTypeEnvironmental, IncidentTypeOther,
}

func (i IncidentType) String() string { return string(i) }

// IsValidIncidentType reports whether s names a known incident type.
func IsValidIncidentType(s string) bool { return isValid(IncidentTypes, s) }

// Severity ranks how serious an incident is, ascending.
type Severity string

const (
	SeverityLow       Severity = "low"
	SeverityMedium    Severity = "medium"
	SeverityHigh      Severity = "high"
	SeverityEmergency Severity = "emergency"
)

// Severities lists every valid Severity from least to most severe.
var Severities = []Severity{SeverityLow, SeverityMedium, SeverityHigh, SeverityEmergency}

func (s Severity) String() string { return string(s) }

// IsValidSeverity reports whether s names a known severity.
func IsValidSeverity(s string) bool { return isValid(Severities, s) }

// Rank returns the severity's position in the ordered Severities list, so
// callers can compare urgency without hard-coding the ordering. Unknown values
// rank -1.
func (s Severity) Rank() int {
	for i, known := range Severities {
		if known == s {
			return i
		}
	}
	return -1
}

// ReportStatus is the lifecycle state of a daily report.
type ReportStatus string

const (
	ReportStatusDraft        ReportStatus = "draft"
	ReportStatusSubmitted    ReportStatus = "submitted"
	ReportStatusAcknowledged ReportStatus = "acknowledged"
)

// ReportStatuses lists every valid ReportStatus in lifecycle order.
var ReportStatuses = []ReportStatus{
	ReportStatusDraft, ReportStatusSubmitted, ReportStatusAcknowledged,
}

func (s ReportStatus) String() string { return string(s) }

// IsValidReportStatus reports whether s names a known report status.
func IsValidReportStatus(s string) bool { return isValid(ReportStatuses, s) }

// ContributorRole records which hat a contributor wore when filing a report.
// It is a deliberate subset of Role: viewers never contribute (RFC §10.1).
type ContributorRole string

const (
	ContributorRoleCaregiver ContributorRole = "caregiver"
	ContributorRoleOwner     ContributorRole = "owner"
)

// ContributorRoles lists every valid ContributorRole.
var ContributorRoles = []ContributorRole{ContributorRoleCaregiver, ContributorRoleOwner}

func (c ContributorRole) String() string { return string(c) }

// IsValidContributorRole reports whether s names a known contributor role.
func IsValidContributorRole(s string) bool { return isValid(ContributorRoles, s) }

// ReportType distinguishes a full entry-by-entry report from a short summary.
type ReportType string

const (
	ReportTypeDetailed ReportType = "detailed"
	ReportTypeSummary  ReportType = "summary"
)

// ReportTypes lists every valid ReportType.
var ReportTypes = []ReportType{ReportTypeDetailed, ReportTypeSummary}

func (r ReportType) String() string { return string(r) }

// IsValidReportType reports whether s names a known report type.
func IsValidReportType(s string) bool { return isValid(ReportTypes, s) }

// Plan is a workspace's subscription tier.
type Plan string

const (
	PlanFree    Plan = "free"
	PlanStarter Plan = "starter"
	PlanPro     Plan = "pro"
)

// Plans lists every valid Plan from cheapest to most capable.
var Plans = []Plan{PlanFree, PlanStarter, PlanPro}

func (p Plan) String() string { return string(p) }

// IsValidPlan reports whether s names a known plan.
func IsValidPlan(s string) bool { return isValid(Plans, s) }

// Locale is a supported UI and email language. Bahasa Indonesia is the default.
type Locale string

const (
	LocaleID Locale = "id"
	LocaleEN Locale = "en"
)

// Locales lists every supported Locale, default first.
var Locales = []Locale{LocaleID, LocaleEN}

// DefaultLocale is used whenever a user has expressed no preference.
const DefaultLocale = LocaleID

func (l Locale) String() string { return string(l) }

// IsValidLocale reports whether s names a supported locale.
func IsValidLocale(s string) bool { return isValid(Locales, s) }

// PlanLimit captures the quota a plan grants. A nil field means unlimited, which
// mirrors the NULL columns in the plan_configs table (RFC §4.2).
type PlanLimit struct {
	MaxRecipients  *int `json:"maxRecipients"`
	MaxCaregivers  *int `json:"maxCaregivers"`
	HistoryDays    *int `json:"historyDays"`
	StorageMB      *int `json:"storageMB"`
	MaxBackfillDay int  `json:"maxBackfillDays"`
}

// PlanLimits mirrors the seeded rows of the plan_configs table. The database
// remains the runtime authority; this map exists so the API and the UI can agree
// on limits without a round trip, and so drift is caught by tests.
var PlanLimits = map[Plan]PlanLimit{
	PlanFree: {
		MaxRecipients:  intPtr(2),
		MaxCaregivers:  intPtr(3),
		HistoryDays:    intPtr(7),
		StorageMB:      intPtr(500),
		MaxBackfillDay: 1,
	},
	PlanStarter: {
		MaxRecipients:  intPtr(5),
		MaxCaregivers:  intPtr(10),
		HistoryDays:    intPtr(90),
		StorageMB:      intPtr(5120),
		MaxBackfillDay: 3,
	},
	PlanPro: {
		MaxRecipients:  nil,
		MaxCaregivers:  nil,
		HistoryDays:    nil,
		StorageMB:      intPtr(20480),
		MaxBackfillDay: 7,
	},
}

// LimitsFor returns the quota for a plan and whether the plan is known.
func LimitsFor(p Plan) (PlanLimit, bool) {
	l, ok := PlanLimits[p]
	return l, ok
}

func intPtr(i int) *int { return &i }

// isValid reports whether s equals one of the known values. The ~string
// constraint lets every enum in this package share one implementation.
func isValid[T ~string](known []T, s string) bool {
	for _, k := range known {
		if string(k) == s {
			return true
		}
	}
	return false
}
