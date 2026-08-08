"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Search,
  Building2,
  MapPin,
  Mail,
  Phone,
  Globe,
  Linkedin,
  Eye,
  Pencil,
  Trash2,
  Plus,
  CreditCard,
} from "lucide-react";

type Contact = {
  id: string;
  fullName: string;
  jobTitle: string;
  company: string;
  email: string;
  phone: string;
  website: string;
  linkedin: string;
  location: string;
};

const sampleContacts: Contact[] = [
  {
    id: "1",
    fullName: "John Smith",
    jobTitle: "Software Engineer",
    company: "Microsoft",
    email: "john@microsoft.com",
    phone: "+1 987654321",
    website: "https://microsoft.com",
    linkedin: "https://linkedin.com/in/johnsmith",
    location: "Seattle, USA",
  },
  {
    id: "2",
    fullName: "Emily Johnson",
    jobTitle: "HR Manager",
    company: "Google",
    email: "emily@google.com",
    phone: "+1 123456789",
    website: "https://google.com",
    linkedin: "https://linkedin.com/in/emilyjohnson",
    location: "California, USA",
  },
];

export default function DirectoryPage() {
  const [search, setSearch] = useState("");

  const contacts = useMemo(() => {
    return sampleContacts.filter((contact) => {
      const value = search.toLowerCase();

      return (
        contact.fullName.toLowerCase().includes(value) ||
        contact.company.toLowerCase().includes(value) ||
        contact.jobTitle.toLowerCase().includes(value)
      );
    });
  }, [search]);

  return (
    <div className="min-h-screen bg-slate-100">

      <div className="max-w-7xl mx-auto p-8">

        {/* Header */}

        <div className="flex justify-between items-center mb-8">

          <div>

            <h1 className="text-4xl font-bold">
              Business Card Directory
            </h1>

            <p className="text-gray-500 mt-2">
              Browse and manage all scanned business cards.
            </p>

          </div>

          <Link
            href="/"
            className="bg-sky-600 hover:bg-sky-700 text-white px-5 py-3 rounded-lg flex items-center gap-2"
          >
            <Plus size={18} />
            Scan New Card
          </Link>

        </div>

        {/* Search */}

        <div className="bg-white rounded-xl shadow p-6 mb-8">

          <div className="relative">

            <Search
              size={18}
              className="absolute left-3 top-3.5 text-gray-400"
            />

            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, company or designation..."
              className="w-full border rounded-lg py-3 pl-10 pr-4 outline-none focus:ring-2 focus:ring-sky-500"
            />

          </div>

        </div>

        {/* Cards */}

        <div className="grid lg:grid-cols-2 gap-6">

          {contacts.map((contact) => (

            <div
              key={contact.id}
              className="bg-white rounded-xl shadow-lg p-6"
            >

              <div className="flex justify-between">

                <div>

                  <h2 className="text-2xl font-bold">
                    {contact.fullName}
                  </h2>

                  <p className="text-sky-600">
                    {contact.jobTitle}
                  </p>

                </div>

                <CreditCard
                  className="text-sky-600"
                  size={36}
                />

              </div>

              <div className="space-y-3 mt-6">

                <div className="flex gap-3">

                  <Building2 size={18} />

                  <span>{contact.company}</span>

                </div>

                <div className="flex gap-3">

                  <Mail size={18} />

                  <span>{contact.email}</span>

                </div>

                <div className="flex gap-3">

                  <Phone size={18} />

                  <span>{contact.phone}</span>

                </div>

                <div className="flex gap-3">

                  <MapPin size={18} />

                  <span>{contact.location}</span>

                </div>

                <div className="flex gap-3">

                  <Globe size={18} />

                  <a
                    href={contact.website}
                    target="_blank"
                    className="text-blue-600"
                  >
                    {contact.website}
                  </a>

                </div>

                <div className="flex gap-3">

                  <Linkedin size={18} />

                  <a
                    href={contact.linkedin}
                    target="_blank"
                    className="text-blue-600"
                  >
                    LinkedIn
                  </a>

                </div>

              </div>

              <div className="flex gap-3 mt-8">

                <Link
                  href={`/profile/${contact.id}`}
                  className="flex-1 bg-sky-600 text-white py-2 rounded-lg flex justify-center items-center gap-2"
                >
                  <Eye size={18} />
                  View Profile
                </Link>

                <button
                  className="bg-yellow-500 text-white px-4 rounded-lg"
                >
                  <Pencil size={18} />
                </button>

                <button
                  className="bg-red-500 text-white px-4 rounded-lg"
                >
                  <Trash2 size={18} />
                </button>

              </div>

            </div>

          ))}

        </div>

        {contacts.length === 0 && (

          <div className="bg-white rounded-xl shadow p-12 text-center mt-8">

            <h2 className="text-2xl font-semibold">
              No Contacts Found
            </h2>

            <p className="text-gray-500 mt-2">
              Try a different search keyword.
            </p>

          </div>

        )}

      </div>

    </div>
  );
}