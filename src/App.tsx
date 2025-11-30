import React, { useState } from "react";
import { Upload, FileText, Download, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import Papa from "papaparse";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";

export function App() {
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [csvData, setCsvData] = useState<CSVData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type === "text/csv") {
      setCsvFile(file);
      setError(null);

      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          if (results.data && results.data.length > 0) {
            setCsvData(results.data as CSVData[]);
            setSuccess(
              `CSV loaded successfully - ${results.data.length} row(s) found`
            );
          }
        },
        error: (err) => {
          setError(`CSV parsing error: ${err.message}`);
        },
      });
    } else {
      setError("Please upload a valid CSV file");
    }
  };

  const handlePdfUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type === "application/pdf") {
      setPdfFile(file);
      setError(null);
      setSuccess("PDF template loaded successfully");
    } else {
      setError("Please upload a valid PDF file");
    }
  };

  const fillPdfForm = async () => {
    if (!csvData || csvData.length === 0 || !pdfFile) {
      setError("Please upload both CSV and PDF files");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);
    setProgress(null);

    try {
      // Read PDF template once
      const pdfTemplateBytes = await pdfFile.arrayBuffer();

      // Create a zip file
      const zip = new JSZip();

      // Process each row in the CSV
      for (let i = 0; i < csvData.length; i++) {
        const rowData = csvData[i];
        setProgress(`Processing ${i + 1} of ${csvData.length}...`);

        // Load a fresh copy of the PDF for each row
        const pdfDoc = await PDFDocument.load(pdfTemplateBytes);
        const form = pdfDoc.getForm();

        console.log(`\n=== Processing Row ${i + 1} ===`);
        console.log("Row Data:", rowData);

        // Fill form fields based on mapping
        Object.entries(FIELD_MAPPING).forEach(([csvColumn, pdfFieldNames]) => {
          const value = rowData[csvColumn];

          // Handle both single field (string) and multiple fields (array)
          const fieldNamesArray = Array.isArray(pdfFieldNames)
            ? pdfFieldNames
            : [pdfFieldNames];

          if (value !== undefined && value !== null && value !== "") {
            fieldNamesArray.forEach((pdfFieldName) => {
              try {
                // Try as text field first (most common)
                try {
                  const textField = form.getTextField(pdfFieldName);
                  textField.setText(String(value));
                  console.log(
                    `  ✓ Set text field "${pdfFieldName}" = "${value}"`
                  );
                } catch (textErr) {
                  // If text field fails, try as checkbox
                  try {
                    const checkbox = form.getCheckBox(pdfFieldName);
                    const isChecked =
                      value.toLowerCase() === "true" ||
                      value.toLowerCase() === "yes" ||
                      value === "1";
                    if (isChecked) {
                      checkbox.check();
                    } else {
                      checkbox.uncheck();
                    }
                    console.log(
                      `  ✓ Set checkbox "${pdfFieldName}" = ${isChecked}`
                    );
                  } catch (checkErr) {
                    console.warn(
                      `  ⚠ Field "${pdfFieldName}" found but couldn't set (not text or checkbox)`
                    );
                  }
                }
              } catch (err) {
                console.warn(`  ⚠ Field "${pdfFieldName}" not found`);
              }
            });
          }
        });

        // Set the county
        const textField = form.getTextField(PDF_FIELDS.COURT_ADDRESS);
        const county = rowData[CSV_COLUMNS.COUNTY] ?? "";
        const {
          address,
          city,
          zip: postal_code,
          state,
        } = COURT_ADDRESSES.get(county.toLowerCase()) ?? {};
        if (COURT_ADDRESSES.has(county.toLowerCase())) {
          textField.setText(`${address}, ${city}, ${state} ${postal_code}`);
        }

        // Save the filled PDF
        const filledPdfBytes = await pdfDoc.save();

        // Generate filename using tenant name or row number
        const tenantName = rowData["Tenant"] || `Row_${i + 1}`;
        const safeFilename = tenantName
          .replace(/[^a-z0-9]/gi, "_")
          .substring(0, 50);
        const filename = `${safeFilename}_${i + 1}.pdf`;

        // Add to zip
        zip.file(filename, filledPdfBytes);
      }

      setProgress("Creating zip file...");

      // Generate the zip file
      const zipBlob = await zip.generateAsync({ type: "blob" });

      // Download the zip
      const url = URL.createObjectURL(zipBlob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `filled-forms-${
        new Date().toISOString().split("T")[0]
      }.zip`;
      link.click();
      URL.revokeObjectURL(url);

      setProgress(null);
      setSuccess(
        `Successfully generated ${csvData.length} PDF(s) and downloaded as zip file!`
      );
    } catch (err) {
      setError(
        `Error filling PDFs: ${
          err instanceof Error ? err.message : "Unknown error"
        }`
      );
      console.error(err);
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            PDF Form Filler
          </h1>
          <p className="text-gray-600">
            Upload a CSV and PDF template to generate filled forms
          </p>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {success && (
          <Alert className="border-green-500 text-green-700 bg-green-50">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{success}</AlertDescription>
          </Alert>
        )}

        {progress && (
          <Alert className="border-blue-500 text-blue-700 bg-blue-50">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{progress}</AlertDescription>
          </Alert>
        )}

        <div className="grid md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                CSV Data
              </CardTitle>
              <CardDescription>
                Upload your CSV file with form data
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-gray-400 transition-colors">
                  <input
                    type="file"
                    accept=".csv"
                    onChange={handleCsvUpload}
                    className="hidden"
                    id="csv-upload"
                  />
                  <label htmlFor="csv-upload" className="cursor-pointer">
                    <Upload className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                    <p className="text-sm text-gray-600">
                      {csvFile ? csvFile.name : "Click to upload CSV"}
                    </p>
                  </label>
                </div>
                {csvData && csvData.length > 0 && (
                  <div className="text-xs bg-gray-100 p-3 rounded">
                    <p className="font-semibold mb-1">
                      Loaded {csvData.length} row(s)
                    </p>
                    <p className="text-gray-600">
                      Columns: {Object.keys(csvData[0]).join(", ")}
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                PDF Template
              </CardTitle>
              <CardDescription>Upload your PDF form template</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-gray-400 transition-colors">
                <input
                  type="file"
                  accept=".pdf"
                  onChange={handlePdfUpload}
                  className="hidden"
                  id="pdf-upload"
                />
                <label htmlFor="pdf-upload" className="cursor-pointer">
                  <Upload className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                  <p className="text-sm text-gray-600">
                    {pdfFile ? pdfFile.name : "Click to upload PDF"}
                  </p>
                </label>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Field Mapping (Hard-coded)</CardTitle>
            <CardDescription>Current CSV to PDF field mappings</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {Object.entries(FIELD_MAPPING).map(([csv, pdf]) => (
                <div
                  key={csv}
                  className="flex items-center gap-2 p-2 bg-gray-50 rounded"
                >
                  <span className="font-mono text-blue-600">{csv}</span>
                  <span className="text-gray-400">→</span>
                  <span className="font-mono text-green-600">
                    {Array.isArray(pdf) ? pdf.join(", ") : pdf}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-center">
          <Button
            onClick={fillPdfForm}
            disabled={!csvFile || !pdfFile || loading || csvData.length === 0}
            size="lg"
            className="w-full md:w-auto"
          >
            {loading ? (
              <>{progress || "Processing..."}</>
            ) : (
              <>
                <Download className="mr-2 h-5 w-5" />
                Generate{" "}
                {csvData.length > 0 ? `${csvData.length} PDFs` : "PDFs"} (Zip)
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

interface CSVData {
  [key: string]: string;
}
const CSV_COLUMNS = {
  COUNTY: "County",
  LANDLORD: "Landlord",
  TENANT: "Tenant",
  STREET_ADDRESS: "Street Address",
  CITY: "City",
  ZIP: "Zip",
} as const;

const PDF_FIELDS = {
  COURT_ADDRESS: "Court Address",
  COURT_COUNTY: "Court County",
} as const;

// Hard-coded mapping from CSV columns to PDF field names
// Each CSV column can map to a single field (string) or multiple fields (array)
const FIELD_MAPPING: { [key: string]: string | string[] } = {
  [CSV_COLUMNS.COUNTY]: [PDF_FIELDS.COURT_COUNTY, "7.3"], // Field #1 and #26
  [CSV_COLUMNS.LANDLORD]: "π", // Field #3 - Plaintiff
  [CSV_COLUMNS.TENANT]: ["∆", "7.0"], // Field #4 - Defendant, Field #23
  [CSV_COLUMNS.STREET_ADDRESS]: "7.1", // Tenant address
  [CSV_COLUMNS.CITY]: "7.2", // Tenant city
  [CSV_COLUMNS.ZIP]: "7.4", // Tenant zip
  // State field #8 - not in CSV, will need manual entry or default value
  // Phone field #10 - not in CSV
  // Email field #11 - not in CSV
  // Financial fields (Rent Owed, Damages, Total, etc.) - leaving blank for manual entry
  // Date fields (Prior Notice, Summons Date, Time) - leaving blank for manual entry
  // All other numbered fields - leaving blank for manual entry
};

/**
 * Map county names to their addresses
 */
const COURT_ADDRESSES = new Map<
  string,
  { address: string; city: string; state: string; zip: number }
>([
  [
    "boulder",
    { address: "1777 6TH ST.", city: "BOULDER", state: "CO", zip: 80302 },
  ],
  [
    "arapahoe",
    {
      address: "1790 West Littleton Blvd",
      city: "Littleton",
      state: "CO",
      zip: 80120,
    },
  ],
  [
    "adams",
    {
      address: "1100 Judicial Center Dr",
      city: "Brighton",
      state: "CO",
      zip: 80601,
    },
  ],
  [
    "jefferson",
    {
      address: "100 Jefferson County Pkwy",
      city: "Golden",
      state: "CO",
      zip: 80401,
    },
  ],
  [
    "broomfield",
    { address: "17 Descombes Dr", city: "Broomfield", state: "CO", zip: 80020 },
  ],
  [
    "douglas",
    {
      address: "4000 Justice Way",
      city: "Castle Rock",
      state: "CO",
      zip: 80109,
    },
  ],
  [
    "el paso",
    {
      address: "270 S Tejon St",
      city: "Colorado Springs",
      state: "CO",
      zip: 80903,
    },
  ],
  [
    "weld",
    { address: "901 9th Ave", city: "Greeley", state: "CO", zip: 80631 },
  ],
  [
    "denver",
    {
      address: "Colorado 1437 Bannock Street, Room 135 Denver",
      city: "Denver",
      state: "CO",
      zip: 80202,
    },
  ],
]);
