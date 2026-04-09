export async function exportSimpleReportPdf(title: string, subtitle: string, lines: string[], filename: string) {
  const { default: jsPDF } = await import('jspdf');
  const doc = new jsPDF();
  doc.setFontSize(14);
  doc.text(title, 14, 14);
  doc.setFontSize(10);
  doc.text(subtitle, 14, 22);
  let y = 32;
  lines.forEach((line) => {
    doc.text(line.slice(0, 180), 14, y);
    y += 6;
    if (y > 280) {
      doc.addPage();
      y = 14;
    }
  });
  doc.save(filename);
}
