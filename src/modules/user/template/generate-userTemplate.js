import xlsx from "xlsx";

/**
 * Generate user template Excel file
 * @returns {Buffer} Excel file buffer
 */
export const generateUserTemplate = () => {
  const templateData = [
    {
      firstName: "John",
      lastName: "Doe",
      email: "john.doe@example.com",
      password: "password123",
      phone: "1234567890",
      role: "STUDENT",
      plan: "FREE",
      address_line1: "",
      address_city: "",
      address_state: "",
      address_country: "",
      address_zipCode: "",
      education_qualification: "",
      education_stream: "",
      education_passingYear: "",
      education_college: "",
      isEmailVerified: "FALSE"
    },
    {
      firstName: "Jane",
      lastName: "Smith",
      email: "jane.smith@example.com",
      password: "password123",
      phone: "0987654321",
      role: "IQPATH_ADMIN",
      plan: "PAID",
      address_line1: "123 Main St",
      address_city: "New York",
      address_state: "NY",
      address_country: "USA",
      address_zipCode: "10001",
      education_qualification: "Masters",
      education_stream: "Computer Science",
      education_passingYear: "2020",
      education_college: "NYU",
      isEmailVerified: "TRUE"
    },
    {
      firstName: "Bob",
      lastName: "Johnson",
      email: "bob.johnson@example.com",
      password: "password123",
      phone: "5551234567",
      role: "STUDENT",
      plan: "FREE",
      address_line1: "",
      address_city: "",
      address_state: "",
      address_country: "",
      address_zipCode: "",
      education_qualification: "",
      education_stream: "",
      education_passingYear: "",
      education_college: "",
      isEmailVerified: "FALSE"
    },
    {
      firstName: "Alice",
      lastName: "Brown",
      email: "alice.brown@example.com",
      password: "password123",
      phone: "5559876543",
      role: "ORGANIZATION",
      plan: "PAID",
      address_line1: "456 Oak Ave",
      address_city: "Los Angeles",
      address_state: "CA",
      address_country: "USA",
      address_zipCode: "90210",
      education_qualification: "PhD",
      education_stream: "Business Administration",
      education_passingYear: "2018",
      education_college: "UCLA",
      isEmailVerified: "TRUE"
    },
    {
      firstName: "Charlie",
      lastName: "Wilson",
      email: "charlie.wilson@example.com",
      password: "password123",
      phone: "5555555555",
      role: "IQPATH_ADMIN",
      plan: "PAID",
      address_line1: "789 Pine St",
      address_city: "Chicago",
      address_state: "IL",
      address_country: "USA",
      address_zipCode: "60601",
      education_qualification: "MBA",
      education_stream: "Finance",
      education_passingYear: "2019",
      education_college: "University of Chicago",
      isEmailVerified: "TRUE"
    },
    // Empty row for user to fill
    {
      firstName: "",
      lastName: "",
      email: "",
      password: "",
      phone: "",
      role: "",
      plan: "",
      address_line1: "",
      address_city: "",
      address_state: "",
      address_country: "",
      address_zipCode: "",
      education_qualification: "",
      education_stream: "",
      education_passingYear: "",
      education_college: "",
      isEmailVerified: ""
    }
  ];

  const worksheet = xlsx.utils.json_to_sheet(templateData);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, "Users");

  const buffer = xlsx.write(workbook, { type: "buffer", bookType: "xlsx" });
  return buffer;
};