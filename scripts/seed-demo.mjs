// Seeds demo contacts (plus a demo login) so every UI state has data to show.
// Idempotent: re-running replaces the previous demo rows.
//   Seed:   node scripts/seed-demo.mjs
//   Remove: node scripts/seed-demo.mjs --clean
import "dotenv/config";
import { randomUUID } from "node:crypto";
import pg from "pg";
import bcrypt from "bcryptjs";

const TAG = "demo-seed"; // stored in Contact.rawNotes to find demo rows later
const DEMO_EMAIL = "demo@cardfile.test";
const DEMO_PASSWORD = "demo12345";

// [fullName, jobTitle, company, mobiles, phones, emails, website, address, companyLocation, linkedin]
const CONTACTS = [
  ["Ananya Iyer", "Head of Procurement", "Kaveri Steel Works", ["+91 98450 21734"], ["+91 80 4129 8810"], ["ananya.iyer@kaveristeel.in"], "https://kaveristeel.in", "14 Residency Road, Bengaluru 560025", "Bengaluru, Karnataka, India", "https://linkedin.com/in/ananya-iyer"],
  ["Rohan Mehta", "Founder & CEO", "Tidewater Logistics", ["+91 99201 44518"], [], ["rohan@tidewater.co.in"], "https://tidewater.co.in", "Unit 402, Nariman Point, Mumbai 400021", "Mumbai, Maharashtra, India", "https://linkedin.com/in/rohanmehta"],
  ["Farhan Qureshi", "Senior Sales Engineer", "Laserline Photonics", ["+91 98110 67342", "+91 97173 20985"], ["+91 11 4652 3300"], ["f.qureshi@laserline.in", "sales@laserline.in"], "https://laserline.in", "B-22 Okhla Industrial Area Phase II, New Delhi 110020", "New Delhi, Delhi, India", null],
  ["Meenakshi Sundaram", "Plant Manager", "Coromandel Fabricators", ["+91 94440 18263"], [], ["meenakshi.s@coromandelfab.com"], null, "SIDCO Industrial Estate, Guindy, Chennai 600032", "Chennai, Tamil Nadu, India", null],
  ["Arjun Bhattacharya", "Director, Business Development", "Eastline Machine Tools", ["+91 98300 55127"], ["+91 33 2289 4410"], ["arjun.b@eastline.in"], "https://eastline.in", "Salt Lake Sector V, Kolkata 700091", "Kolkata, West Bengal, India", "https://linkedin.com/in/arjunbhatta"],
  ["Priya Deshpande", "Quality Assurance Lead", "Sahyadri Precision", ["+91 98221 90473"], [], ["priya.deshpande@sahyadriprecision.com"], "https://sahyadriprecision.com", "Plot 71, MIDC Bhosari, Pune 411026", "Pune, Maharashtra, India", null],
  ["Vikram Reddy", "Chief Technology Officer", "Deccan Automation Systems", ["+91 99490 31186"], ["+91 40 6612 0045"], ["vikram@deccanautomation.io"], "https://deccanautomation.io", "HITEC City, Madhapur, Hyderabad 500081", "Hyderabad, Telangana, India", "https://linkedin.com/in/vikram-reddy-cto"],
  ["Bidisha Kalita", "Regional Manager", "Brahmaputra Industrial Supplies", ["+91 94350 77216"], [], ["bidisha.k@bisupplies.in"], null, "GS Road, Christian Basti, Guwahati 781005", "Guwahati, Assam, India", null],
  ["Harpreet Singh Gill", "Owner", "Gill Sheet Metal & Engineering", ["+91 98140 23657"], ["+91 161 250 7781"], [], null, "Focal Point Phase VIII, Ludhiana 141010", "Ludhiana, Punjab, India", null],
  ["Neha Agarwal", "Purchase Executive", "Rajputana Castings", ["+91 94140 66201"], [], ["purchase@rajputanacastings.com"], "https://rajputanacastings.com", "Sitapura Industrial Area, Jaipur 302022", "Jaipur, Rajasthan, India", null],
  ["Thomas Kurian", "General Manager, Operations", "Malabar Marine Engineering", ["+91 98470 11948"], [], ["thomas.kurian@malabarmarine.com"], "https://malabarmarine.com", "Willingdon Island, Kochi 682003", "Kochi, Kerala, India", "https://linkedin.com/in/thomaskurian"],
  ["Sanjay Patel", "Managing Partner", "Sabarmati CNC Works", ["+91 98250 43310"], ["+91 79 2583 1167"], ["sanjay@sabarmaticnc.com"], null, "GIDC Vatva, Ahmedabad 382445", "Ahmedabad, Gujarat, India", null],
  ["Ishita Banerjee", "Marketing Manager", "Luminar Cutting Solutions", ["+91 90070 58821"], [], ["ishita@luminarcutting.com"], "https://luminarcutting.com", null, "Kolkata, West Bengal, India", "https://linkedin.com/in/ishita-banerjee"],
  ["Karthik Natarajan", "Service Engineer", "Nilgiri Laser Services", ["+91 97890 36612"], [], ["karthik.n@nilgirilaser.in"], null, "Peelamedu, Coimbatore 641004", "Coimbatore, Tamil Nadu, India", null],
  ["Aditya Kulkarni", null, "Konkan Heavy Industries", ["+91 98200 71459"], [], [], null, null, "Navi Mumbai, Maharashtra, India", null],
  ["Sophie Laurent", "Export Sales Director", "Atelier Lumière Industrie", ["+33 6 41 27 88 05"], ["+33 4 72 10 36 90"], ["s.laurent@atelier-lumiere.fr"], "https://atelier-lumiere.fr", "27 Rue de la République, 69002 Lyon", "Lyon, France", "https://linkedin.com/in/sophielaurent"],
  ["Kenji Watanabe", "Application Engineer", "Hoshino Optics Co., Ltd.", ["+81 90 4418 2276"], [], ["k.watanabe@hoshino-optics.jp"], "https://hoshino-optics.jp", "2-8-14 Shiba, Minato-ku, Tokyo 105-0014", "Tokyo, Japan", null],
  ["Daniel Okafor", "Procurement Specialist", "Lagos Steel Fabrication Ltd", ["+234 803 417 2290"], [], ["daniel.okafor@lsfl.com.ng"], null, "Plot 9, Oregun Industrial Estate, Ikeja, Lagos", "Lagos, Nigeria", null],
  ["Maria González", "Technical Buyer", "Metalúrgica del Norte", ["+52 81 1937 4402"], [], ["mgonzalez@metnorte.mx"], "https://metnorte.mx", "Av. Constitución 2045, Monterrey, N.L.", "Monterrey, Mexico", null],
  ["Liam O'Connor", "Operations Director", "Harbourside Engineering", ["+353 87 294 6613"], ["+353 1 677 0482"], ["liam@harbourside.ie"], "https://harbourside.ie", "Grand Canal Dock, Dublin 2", "Dublin, Ireland", "https://linkedin.com/in/liamoconnor"],
  ["Aisha Rahman", "Supply Chain Analyst", "Gulf Precision Metals LLC", ["+971 50 318 7742"], [], ["aisha.rahman@gulfprecision.ae"], null, "Jebel Ali Free Zone, Dubai", "Dubai, United Arab Emirates", null],
  ["Sneha Pillai", "Design Engineer", "Trivandrum Tech Fab", [], ["+91 471 272 9034"], ["sneha.pillai@tvmtechfab.in"], null, "Technopark Phase I, Thiruvananthapuram 695581", "Thiruvananthapuram, Kerala, India", null],
  ["Rajat Srivastava", "Area Sales Manager — North & Central India, Industrial Laser Division", "Ganga Photonics Private Limited", ["+91 94150 82367"], [], ["rajat.srivastava@gangaphotonics.co.in"], "https://gangaphotonics.co.in", "Gomti Nagar, Lucknow 226010", "Lucknow, Uttar Pradesh, India", null],
  [null, null, "Unnamed Card Co.", [], [], ["info@unnamedcard.co"], null, null, null, null],
];

// index into CONTACTS -> enrichment data, covering every status the UI renders.
const ENRICHMENT = {
  0: { status: "DONE", summary: "Ananya leads procurement at Kaveri Steel Works, a mid-sized steel fabricator supplying structural components across South India. She has 12 years of experience in industrial sourcing and vendor development.", company_details: "Kaveri Steel Works, founded 1998, runs two plants in Bengaluru and Hosur.", company_core_business: "Structural steel fabrication, laser-cut components", official_site: "https://kaveristeel.in", location: "Bengaluru, India", career_background: "Previously sourcing manager at Tata Projects (2014–2019).", linkedin_url: "https://linkedin.com/in/ananya-iyer" },
  1: { status: "DONE", summary: "Rohan founded Tidewater Logistics in 2016. The company handles port-side freight forwarding for heavy machinery imports.", company_core_business: "Freight forwarding, heavy-machinery logistics", official_site: "https://tidewater.co.in", location: "Mumbai, India", linkedin_url: "https://linkedin.com/in/rohanmehta", twitter_url: "https://x.com/rohan_tidewater" },
  4: { status: "DONE", summary: "Arjun drives business development for Eastline Machine Tools in eastern India, focused on CNC and laser cutting equipment.", company_core_business: "Machine-tool distribution", location: "Kolkata, India", linkedin_url: "https://linkedin.com/in/arjunbhatta" },
  6: { status: "DONE", summary: "Vikram is CTO at Deccan Automation Systems, building PLC-based automation for sheet-metal lines.", company_details: "Series A startup, ~80 employees.", official_site: "https://deccanautomation.io", location: "Hyderabad, India", linkedin_url: "https://linkedin.com/in/vikram-reddy-cto" },
  10: { status: "DONE", summary: "Thomas oversees operations at Malabar Marine Engineering, a ship-repair yard at Kochi port.", location: "Kochi, India", linkedin_url: "https://linkedin.com/in/thomaskurian" },
  15: { status: "DONE", summary: "Sophie runs export sales at Atelier Lumière Industrie, a French maker of laser optics for industrial cutting.", company_core_business: "Laser optics manufacturing", official_site: "https://atelier-lumiere.fr", location: "Lyon, France", linkedin_url: "https://linkedin.com/in/sophielaurent" },
  2: { status: "PARTIAL", summary: "Farhan is a senior sales engineer at Laserline Photonics. Social profiles could not be verified." },
  19: { status: "RUNNING" },
  3: { status: "PENDING" },
  17: { status: "FAILED" },
};

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  await client.query("BEGIN");

  // Enrichment rows cascade-delete with their contact.
  const { rowCount: removed } = await client.query(`DELETE FROM "Contact" WHERE "rawNotes" = $1`, [TAG]);
  console.log(`Removed ${removed} previous demo contacts.`);

  if (process.argv.includes("--clean")) {
    await client.query(`DELETE FROM "User" WHERE email = $1`, [DEMO_EMAIL]);
    await client.query("COMMIT");
    console.log("Demo data removed.");
    process.exit(0);
  }

  for (const [i, c] of CONTACTS.entries()) {
    const id = randomUUID();
    const [fullName, jobTitle, company, mobiles, phones, emails, website, address, companyLocation, linkedin] = c;
    // Spread creation dates over the last ~2 months so ordering looks real.
    const createdAt = new Date(Date.now() - (i * 2.6 + (i % 3)) * 86400000);

    await client.query(
      `INSERT INTO "Contact" (id, "fullName", "jobTitle", company, "mobileNumbers", "telephoneNumbers", emails,
         website, address, "companyLocation", linkedin, "rawNotes", "createdAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [id, fullName, jobTitle, company, mobiles, phones, emails, website, address, companyLocation, linkedin, TAG, createdAt]
    );

    const e = ENRICHMENT[i];
    if (e) {
      const done = e.status === "DONE" || e.status === "PARTIAL";
      await client.query(
        `INSERT INTO enrichment (contact_id, status, attempts, completed, failed, expected,
           linkedin_url, twitter_url, company_details, company_core_business, official_site,
           location, career_background, summary, updated_at, enriched_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now(),$15)`,
        [id, e.status, e.status === "PENDING" ? 0 : 1, done ? 5 : 0, e.status === "FAILED" ? 6 : e.status === "PARTIAL" ? 2 : 0, 6,
          e.linkedin_url ?? null, e.twitter_url ?? null, e.company_details ?? null, e.company_core_business ?? null,
          e.official_site ?? null, e.location ?? null, e.career_background ?? null, e.summary ?? null, done ? createdAt : null]
      );
    }
  }

  // DEVELOPER role unlocks every control (profile collection, "Research all").
  const hash = await bcrypt.hash(DEMO_PASSWORD, 12);
  await client.query(
    `INSERT INTO "User" (id, name, email, password, role, "createdAt", "updatedAt")
     VALUES ($1, 'Demo Reviewer', $2, $3, 'DEVELOPER', now(), now())
     ON CONFLICT (email) DO UPDATE SET password = EXCLUDED.password, role = 'DEVELOPER', "updatedAt" = now()`,
    [randomUUID(), DEMO_EMAIL, hash]
  );

  await client.query("COMMIT");
  console.log(`Seeded ${CONTACTS.length} contacts (${Object.keys(ENRICHMENT).length} with enrichment).`);
  console.log(`Demo login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
} catch (err) {
  await client.query("ROLLBACK");
  throw err;
} finally {
  await client.end();
}
