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
    lastName: person.lastName,
    registerNo: person.registerNo,
    birthDate: person.birthDate,
    phone: person.phone,
    email: person.email,
    homeAddress: person.homeAddress,
    bankName: person.bankName,
    bankAccountNo: person.bankAccountNo,
    iban: person.iban,
    hireDate: person.hireDate,
    terminationDate: person.terminationDate,
    department: person.department,
    employmentType: person.employmentType,
    position: person.position,
    baseSalary: Number(person.baseSalary),
    employerSiPercent: Number(person.employerSiPercent),
    isActive: person.isActive,
  }));

  return <EmployeesView rows={rows} />;
}
