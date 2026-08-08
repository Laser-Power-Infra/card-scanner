-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "fullName" TEXT,
    "jobTitle" TEXT,
    "company" TEXT,
    "mobileNumbers" TEXT[],
    "telephoneNumbers" TEXT[],
    "emails" TEXT[],
    "website" TEXT,
    "address" TEXT,
    "companyLocation" TEXT,
    "linkedin" TEXT,
    "rawNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);
