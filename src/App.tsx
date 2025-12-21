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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import Papa from "papaparse";
import { PDFDocument, type PDFForm } from "pdf-lib";
import JSZip from "jszip";

interface CSVData {
  [key: string]: string;
}

interface PdfOutput {
  filename: string;
  displayName: string;
  fieldMapping: { [key: string]: string | string[] };
  customLogic?: (form: PDFForm, rowData: CSVData) => void;
}

interface TemplateConfig {
  id: string;
  name: string;
  pdfOutputs: PdfOutput[];
}

export function App() {
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [currentTemplate, setCurrentTemplate] = useState<TemplateConfig | null>(
    null,
  );
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [pdfFiles, setPdfFiles] = useState<Map<string, File>>(new Map());
  const [csvData, setCsvData] = useState<CSVData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const handleTemplateChange = async (value: string) => {
    setSelectedTemplate(value);
    setCsvFile(null);
    setCsvData([]);
    setError(null);
    setSuccess(null);

    if (value) {
      const template = TEMPLATES.find((t) => t.id === value);
      if (template) {
        setCurrentTemplate(template);

        // Load all PDF templates for this template
        const loadedPdfs = new Map<string, File>();
        try {
          for (const output of template.pdfOutputs) {
            const response = await fetch(`/templates/${output.filename}`);
            if (!response.ok) {
              throw new Error(
                `Failed to load PDF template: ${output.filename}`,
              );
            }
            const blob = await response.blob();
            const file = new File([blob], output.filename, {
              type: "application/pdf",
            });
            loadedPdfs.set(output.filename, file);

            // Log PDF field names for debugging (commented out by default)
            const pdfBytes = await blob.arrayBuffer();
            const pdfDoc = await PDFDocument.load(pdfBytes);
            const form = pdfDoc.getForm();
            const fields = form.getFields();
            console.log(`\n=== PDF Field Names for ${output.displayName} ===`);
            fields.forEach((field, index) => {
              console.log(`${index}: "${field.getName()}"`);
            });
            console.log(`Total fields: ${fields.length}\n`);
          }
          setPdfFiles(loadedPdfs);
          setSuccess(
            `Template loaded: ${template.name} (${template.pdfOutputs.length} PDF(s))`,
          );
        } catch (err) {
          setError(
            `Error loading PDF template: ${
              err instanceof Error ? err.message : "Unknown error"
            }`,
          );
          setPdfFiles(new Map());
        }
      }
    } else {
      setCurrentTemplate(null);
      setPdfFiles(new Map());
    }
  };

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
              `CSV loaded successfully - ${results.data.length} row(s) found`,
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

  const fillPdfForm = async () => {
    if (!currentTemplate) {
      setError("Please select a template");
      return;
    }

    if (!csvData || csvData.length === 0 || pdfFiles.size === 0) {
      setError("Please upload CSV file");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);
    setProgress(null);

    try {
      const zip = new JSZip();
      let totalPdfsGenerated = 0;

      // Process each row in the CSV
      for (let i = 0; i < csvData.length; i++) {
        const rowData = csvData[i];
        const tenantName = rowData["Tenant"] || `Row_${i + 1}`;
        const safeFilename = tenantName
          .replace(/[^a-z0-9]/gi, "_")
          .substring(0, 50);

        console.log(`\n=== Processing Row ${i + 1}: ${tenantName} ===`);

        // Generate each PDF output for this row
        for (const output of currentTemplate.pdfOutputs) {
          setProgress(
            `Processing ${i + 1} of ${csvData.length} - ${output.displayName}...`,
          );

          const pdfFile = pdfFiles.get(output.filename);
          if (!pdfFile) {
            console.warn(`PDF file not found: ${output.filename}`);
            continue;
          }

          const pdfTemplateBytes = await pdfFile.arrayBuffer();
          const pdfDoc = await PDFDocument.load(pdfTemplateBytes);
          const form = pdfDoc.getForm();

          console.log(`  Filling ${output.displayName}...`);

          // Fill form fields based on output's field mapping
          Object.entries(output.fieldMapping).forEach(
            ([csvColumn, pdfFieldNames]) => {
              const value = rowData[csvColumn];
              const fieldNamesArray = Array.isArray(pdfFieldNames)
                ? pdfFieldNames
                : [pdfFieldNames];

              if (value !== undefined && value !== null && value !== "") {
                fieldNamesArray.forEach((pdfFieldName) => {
                  try {
                    try {
                      const textField = form.getTextField(pdfFieldName);
                      textField.setText(String(value));
                      console.log(
                        `    ✓ Set text field "${pdfFieldName}" = "${value}"`,
                      );
                    } catch {
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
                          `    ✓ Set checkbox "${pdfFieldName}" = ${isChecked}`,
                        );
                      } catch {
                        console.warn(
                          `    ⚠ Field "${pdfFieldName}" couldn't be set`,
                        );
                      }
                    }
                  } catch {
                    console.warn(`    ⚠ Field "${pdfFieldName}" not found`);
                  }
                });
              }
            },
          );

          // Apply output-specific custom logic
          if (output.customLogic) {
            output.customLogic(form, rowData);
          }

          const filledPdfBytes = await pdfDoc.save();

          // Create filename with suffix
          const suffix = output.displayName.toLowerCase().replace(/\s+/g, "_");
          const filename = `${safeFilename}_${i + 1}_${suffix}.pdf`;

          zip.file(filename, filledPdfBytes);
          totalPdfsGenerated++;
        }
      }

      setProgress("Creating zip file...");

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(zipBlob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${currentTemplate.id}-${
        new Date().toISOString().split("T")[0]
      }.zip`;
      link.click();
      URL.revokeObjectURL(url);

      setProgress(null);
      setSuccess(
        `Successfully generated ${totalPdfsGenerated} PDF(s) and downloaded as zip file!`,
      );
    } catch (err) {
      setError(
        `Error filling PDFs: ${
          err instanceof Error ? err.message : "Unknown error"
        }`,
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
            Select a template and upload CSV to generate filled forms
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

        <Card>
          <CardHeader>
            <CardTitle>Select Template</CardTitle>
            <CardDescription>
              Choose which PDF form template to use
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Select
              value={selectedTemplate}
              onValueChange={handleTemplateChange}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a template..." />
              </SelectTrigger>
              <SelectContent>
                {TEMPLATES.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    {template.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {currentTemplate && (
          <>
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
                <CardTitle>PDF Outputs</CardTitle>
                <CardDescription>
                  This template will generate{" "}
                  {currentTemplate.pdfOutputs.length} PDF(s) per row
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {currentTemplate.pdfOutputs.map((output, index) => (
                    <div key={index} className="border rounded p-4">
                      <h4 className="font-semibold mb-2">
                        {output.displayName}
                      </h4>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        {Object.entries(output.fieldMapping).map(
                          ([csv, pdf]) => (
                            <div
                              key={csv}
                              className="flex items-center gap-2 p-2 bg-gray-50 rounded"
                            >
                              <span className="font-mono text-blue-600">
                                {csv}
                              </span>
                              <span className="text-gray-400">→</span>
                              <span className="font-mono text-green-600">
                                {Array.isArray(pdf) ? pdf.join(", ") : pdf}
                              </span>
                            </div>
                          ),
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-center">
              <Button
                onClick={fillPdfForm}
                disabled={
                  !csvFile ||
                  pdfFiles.size === 0 ||
                  loading ||
                  csvData.length === 0
                }
                size="lg"
                className="w-full md:w-auto"
              >
                {loading ? (
                  <>{progress || "Processing..."}</>
                ) : (
                  <>
                    <Download className="mr-2 h-5 w-5" />
                    Generate{" "}
                    {csvData.length > 0
                      ? `${csvData.length * currentTemplate.pdfOutputs.length} PDFs`
                      : "PDFs"}{" "}
                    (Zip)
                  </>
                )}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Template 1: Eviction Complaint and Summons
const EVICTION_COMPLAINT_TEMPLATE: TemplateConfig = {
  id: "eviction-complaint",
  name: "Eviction Complaint, Summons and Affidavit",
  pdfOutputs: [
    {
      filename: "jdf_101_v1.pdf",
      displayName: "Complaint",
      fieldMapping: {
        County: ["Court County", "7.3"],
        Landlord: "π",
        Tenant: ["∆", "6.4", "7.0"],
        "Street Address": "7.1",
        City: "7.2",
        Zip: "7.4",
        "Prior Notice": ["8.1", "8.5"],
        "Prior Notice 2nd": "8.4",
        "Rent Owed": "10A.2",
        "Months of Rent": "10A.4",
        "Rent Per Diem": "10A.5",
        Damages: "12.1",
        Total: "12.3",
      },
      customLogic: (form, rowData) => {
        // Set signature dates
        try {
          const d = new Date();
          const dateField = form.getTextField("Sig1_Date");
          const monthField = form.getTextField("Sig1_Month");
          const yearField = form.getTextField("Sig1_Year");

          dateField.setText(String(d.getDate()));
          monthField.setText(d.toLocaleString("en-US", { month: "long" }));
          yearField.setText(String(d.getFullYear()));
        } catch (error) {
          console.warn("Could not set signature. " + error);
        }

        // Set eviction explanation field
        try {
          const EVICTION_EXPLANATION =
            "Non-payment of utilities and lease charges";
          const evictionExplanationField = form.getTextField("11.0");

          if (!evictionExplanationField) {
            throw new Error("Field not found.");
          }

          const damages = rowData["Damages"];

          if (damages) {
            evictionExplanationField.setText(
              `${EVICTION_EXPLANATION} in the amount ${damages}`,
            );
          } else {
            evictionExplanationField.setText(EVICTION_EXPLANATION);
          }
        } catch (e) {
          console.warn("Could not set eviction explanation field. " + e);
        }

        // Set court address based on county
        try {
          const textField = form.getTextField("Court Address");
          const county = rowData["County"] ?? "";
          const courtInfo = COURT_ADDRESSES.get(county.toLowerCase());

          if (courtInfo) {
            const { address, city, state, zip } = courtInfo;
            textField.setText(`${address}, ${city}, ${state} ${zip}`);
          }
        } catch {
          console.warn("Could not set Court Address field");
        }

        // Format interest rate
        try {
          const interest = form.getTextField("10A.5");
          const fullInterest = rowData["Rent Per Diem"];

          if (fullInterest) {
            const formattedInterest = new Intl.NumberFormat("en-US", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            }).format(Number(fullInterest));
            interest.setText(formattedInterest);
          }
        } catch {
          console.warn("Could not format interest rate");
        }
      },
    },
    {
      filename: "jdf_102_v1.pdf",
      displayName: "Summons",
      fieldMapping: {
        County: "Court County",
        Landlord: "π",
        Tenant: "∆",
        "Summons Date": "2A.1",
        Time: "2A.2",
      },
      customLogic: (form, rowData) => {
        // Set court address
        try {
          const textField = form.getTextField("Court Address");
          const county = rowData["County"] ?? "";
          const courtInfo = COURT_ADDRESSES.get(county.toLowerCase());

          if (courtInfo) {
            const { address, city, state, zip } = courtInfo;
            textField.setText(`${address}, ${city}, ${state} ${zip}`);
          }
        } catch {
          console.warn("Could not set Court Address field");
        }

        // Set signature dates
        try {
          const dateField = form.getTextField("Sig_Date");

          dateField.setText(
            new Intl.DateTimeFormat("en-US").format(new Date()),
          );
        } catch (error) {
          console.warn("Could not set signature. " + error);
        }
      },
    },
    {
      displayName: "CARES Affidavit",
      fieldMapping: {
        County: "court_county",
        Landlord: "plaintiff",
        Tenant: "defendants",
      },
      filename: "cares_affidavit_v1.pdf",
      customLogic: (form, rowData) => {
        // Set court address based on county
        try {
          const textField = form.getTextField("court_address");
          const county = rowData["County"] ?? "";
          const courtInfo = COURT_ADDRESSES.get(county.toLowerCase());

          if (courtInfo) {
            const { address, city, state, zip } = courtInfo;
            textField.setText(`${address}, ${city}, ${state} ${zip}`);
          }
        } catch {
          console.warn("Could not set Court Address field");
        }
      },
    },
  ],
};

// Template 2: Demand for Compliance
const DFC_TEMPLATE: TemplateConfig = {
  id: "demand-compliance",
  name: "Demand for Compliance (DFC Form)",
  pdfOutputs: [
    {
      filename: "dfc_form.pdf",
      displayName: "DFC",
      fieldMapping: {
        Tenant: "0.0",
        "Rent Owed": "1A.1",
        "Street Address": "4.1",
        City: "4.2",
        County: "4.3",
        "Monthly Rent": "4.7",
        "Months of rent": "1A.2",
        Cure: "0.2",
        Date: "6.2",
      },
      customLogic(form, rowData) {
        // Remove dollar sign from rent owed
        try {
          const cure = form.getTextField("1A.1");
          const fullCure = rowData["Rent Owed"];
          if (fullCure) {
            const formattedCure = fullCure.replace("$", "");
            cure.setText(formattedCure);
          }
        } catch {
          console.warn("Could not format rent owed");
        }

        // Remove dollar sign from monthly rent
        try {
          const rent = form.getTextField("4.7");
          const fullRent = rowData["Monthly Rent"];
          if (fullRent) {
            const formattedRent = fullRent.replace("$", "");
            rent.setText(formattedRent);
          }
        } catch {
          console.warn("Could not format monthly rent");
        }
      },
    },
  ],
};

// All available templates
const TEMPLATES: TemplateConfig[] = [EVICTION_COMPLAINT_TEMPLATE, DFC_TEMPLATE];

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
