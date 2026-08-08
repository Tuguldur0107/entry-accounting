import { asc, eq } from "drizzle-orm";

import { EmployeesView, type EmployeeRow } from "@/components/payroll/employees-view";
import { getActiveOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { employees } from "@/lib/db/schema";

export default async function PayrollEmployeesPage() {
  const { orgId } = await getActiveOrg();

  const staff = await db.query.employees.findMany({
    where: eq(employees.organizationId, orgId),
    orderBy: [asc(employees.name)],
  });

  const rows: EmployeeRow[] = staff.map((person) => ({
    id: person.id,
    name: person.name,
    position: person.position,
    baseSalary: Number(person.baseSalary),
    accidentRatePercent: Number(person.accidentRatePercent),
    isActive: person.isActive,
  }));

  return <EmployeesView rows={rows} />;
}
