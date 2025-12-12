const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

/**
 * Extracts text from a file based on its type
 * @param {Buffer} fileBuffer - The file content as a Buffer
 * @param {string} fileName - The original file name
 * @param {string} mimeType - The MIME type of the file
 * @returns {Promise<Object>} { success: boolean, text: string, error: string | null }
 */
async function extractTextFromFile(fileBuffer, fileName, mimeType) {
  try {
    // Determine file type from extension and mime type
    const fileExtension = fileName.toLowerCase().split('.').pop();

    if (fileExtension === 'txt' || mimeType === 'text/plain') {
      return extractFromPlainText(fileBuffer);
    } else if (fileExtension === 'md' || mimeType === 'text/markdown') {
      return extractFromPlainText(fileBuffer);
    } else if (fileExtension === 'pdf' || mimeType === 'application/pdf') {
      return await extractFromPDF(fileBuffer);
    } else if (
      fileExtension === 'docx' ||
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      return await extractFromDOCX(fileBuffer);
    } else {
      return {
        success: false,
        text: '',
        error: `Unsupported file type: ${fileExtension}. Supported: .txt, .md, .pdf, .docx`
      };
    }
  } catch (error) {
    console.error('Error extracting text:', error);
    return {
      success: false,
      text: '',
      error: `Failed to extract text: ${error.message}`
    };
  }
}

/**
 * Extracts text from plain text files (.txt, .md)
 * @param {Buffer} fileBuffer
 * @returns {Object} { success: boolean, text: string, error: string | null }
 */
function extractFromPlainText(fileBuffer) {
  try {
    const text = fileBuffer.toString('utf-8');
    return {
      success: true,
      text: text,
      error: null
    };
  } catch (error) {
    return {
      success: false,
      text: '',
      error: `Failed to decode text file: ${error.message}`
    };
  }
}

/**
 * Extracts text from PDF files
 * @param {Buffer} fileBuffer
 * @returns {Promise<Object>} { success: boolean, text: string, error: string | null }
 */
async function extractFromPDF(fileBuffer) {
  try {
    const data = await pdfParse(fileBuffer);

    if (!data.text || data.text.trim().length === 0) {
      return {
        success: false,
        text: '',
        error: 'PDF contains no extractable text. It may be image-only or corrupted.'
      };
    }

    return {
      success: true,
      text: data.text,
      error: null
    };
  } catch (error) {
    // Check for specific PDF errors
    if (error.message.includes('password')) {
      return {
        success: false,
        text: '',
        error: 'PDF is password-protected. Please provide an unprotected version.'
      };
    }

    return {
      success: false,
      text: '',
      error: `Failed to extract text from PDF: ${error.message}`
    };
  }
}

/**
 * Extracts text from DOCX files
 * @param {Buffer} fileBuffer
 * @returns {Promise<Object>} { success: boolean, text: string, error: string | null }
 */
async function extractFromDOCX(fileBuffer) {
  try {
    const result = await mammoth.extractRawText({ buffer: fileBuffer });

    if (!result.value || result.value.trim().length === 0) {
      return {
        success: false,
        text: '',
        error: 'DOCX contains no extractable text. It may be empty or corrupted.'
      };
    }

    return {
      success: true,
      text: result.value,
      error: null
    };
  } catch (error) {
    return {
      success: false,
      text: '',
      error: `Failed to extract text from DOCX: ${error.message}`
    };
  }
}

module.exports = {
  extractTextFromFile,
  extractFromPlainText,
  extractFromPDF,
  extractFromDOCX
};
