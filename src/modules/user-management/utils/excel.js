
import XLSX from "xlsx";
import fs from "fs";

export const parseExcelFile = async (filePath) => {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  const data = XLSX.utils.sheet_to_json(sheet);

  console.log("RAW EXCEL DATA:", data);

  const students = [];

  for (const row of data) {
    // 🔥 Clean headers (remove spaces + lowercase)
    const cleanedRow = {};

    Object.keys(row).forEach((key) => {
      cleanedRow[key.trim().toLowerCase()] = row[key];
    });

    console.log("CLEANED ROW:", cleanedRow);

    const firstName = cleanedRow.firstname;
    const lastName = cleanedRow.lastname;
    const email = cleanedRow.email;

    if (!firstName || !lastName || !email) {
      throw new Error("Field name missing");
    }

    students.push({
      firstname,
      lastname,
      email,
    });
  }

  return students;
};