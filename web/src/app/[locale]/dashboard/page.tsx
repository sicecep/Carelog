"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useParams } from "next/navigation";

export default function DashboardPage() {
  const t = useTranslations("dashboard");
  const nav = useTranslations("nav");
  const common = useTranslations("common");
  const params = useParams();
  const locale = params.locale as string;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navigation */}
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <span className="text-xl font-bold text-gray-900">{common("appName")}</span>
            </div>
            <div className="flex items-center space-x-8">
              <Link href={`/${locale}/dashboard`} className="text-sm font-medium text-gray-700 hover:text-blue-600">
                {nav("dashboard")}
              </Link>
              <Link href={`/${locale}/recipients`} className="text-sm font-medium text-gray-700 hover:text-blue-600">
                {nav("recipients")}
              </Link>
              <Link href={`/${locale}/reports`} className="text-sm font-medium text-gray-700 hover:text-blue-600">
                {nav("reports")}
              </Link>
              <Link href={`/${locale}/incidents`} className="text-sm font-medium text-gray-700 hover:text-blue-600">
                {nav("incidents")}
              </Link>
              <Link href={`/${locale}/settings`} className="text-sm font-medium text-gray-700 hover:text-blue-600">
                {nav("settings")}
              </Link>
              <button className="text-sm font-medium text-gray-700 hover:text-red-600">
                {nav("logout")}
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">{t("title")}</h1>
          <p className="mt-2 text-gray-600">{t("welcome", { name: "Caregiver" })}</p>
        </div>

        {/* Quick actions */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">{t("quickActions")}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Link
              href={`/${locale}/reports/new`}
              className="p-4 bg-white border border-gray-200 rounded-lg hover:border-blue-300 hover:shadow-md transition-all"
            >
              <div className="flex items-center">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                </div>
                <span className="ml-3 text-sm font-medium text-gray-900">{t("newReport")}</span>
              </div>
            </Link>
            <Link
              href={`/${locale}/incidents/new`}
              className="p-4 bg-white border border-gray-200 rounded-lg hover:border-blue-300 hover:shadow-md transition-all"
            >
              <div className="flex items-center">
                <div className="p-2 bg-red-100 rounded-lg">
                  <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <span className="ml-3 text-sm font-medium text-gray-900">{t("newIncident")}</span>
              </div>
            </Link>
            <Link
              href={`/${locale}/recipients/new`}
              className="p-4 bg-white border border-gray-200 rounded-lg hover:border-blue-300 hover:shadow-md transition-all"
            >
              <div className="flex items-center">
                <div className="p-2 bg-green-100 rounded-lg">
                  <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                  </svg>
                </div>
                <span className="ml-3 text-sm font-medium text-gray-900">{t("addRecipient")}</span>
              </div>
            </Link>
          </div>
        </section>

        {/* Today's reports placeholder */}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">{t("todayReports")}</h2>
            <Link href={`/${locale}/reports`} className="text-sm text-blue-600 hover:text-blue-500">
              View all →
            </Link>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-6 text-center text-gray-500">
            <svg className="mx-auto h-12 w-12 text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
            <p className="text-sm">No reports for today yet.</p>
            <Link href={`/${locale}/reports/new`} className="mt-2 inline-block text-sm font-medium text-blue-600 hover:text-blue-500">
              {t("newReport")}
            </Link>
          </div>
        </section>

        {/* Recent incidents placeholder */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">{t("recentIncidents")}</h2>
            <Link href={`/${locale}/incidents`} className="text-sm text-blue-600 hover:text-blue-500">
              View all →
            </Link>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-6 text-center text-gray-500">
            <svg className="mx-auto h-12 w-12 text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <p className="text-sm">No incidents recorded.</p>
            <Link href={`/${locale}/incidents/new`} className="mt-2 inline-block text-sm font-medium text-blue-600 hover:text-blue-500">
              {t("newIncident")}
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}