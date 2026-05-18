"use client";

export function NewJournalButton() {
  return (
    <button
      type="button"
      onClick={() =>
        window.open(
          "/gl/journal/new",
          "_blank",
          "width=1280,height=800,menubar=no,toolbar=no,location=no,status=no"
        )
      }
      className="h-8 px-3 text-xs font-medium bg-[#1E3A5F] text-white rounded-md hover:bg-[#15294A] transition-colors"
    >
      + Шинэ журнал
    </button>
  );
}
