
const MODEL = "gemini-3.8-flash";

function send(res, status, data) {
  return res.status(status).json(data);
}

function extractJson(text) {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  return JSON.parse(cleaned);
}

function validateSvg(svg) {
  if (typeof svg !== "string" || !svg.trim().startsWith("<svg")) {
    throw new Error("AI did not return a valid SVG.");
  }

  if (
    /<script|foreignObject|<iframe|onload\s*=|onerror\s*=|javascript:|<image\b|<use\b|https?:\/\//i.test(svg)
  ) {
    throw new Error("The generated SVG contains unsupported content.");
  }

  return svg;
}

async function askGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured in Vercel.");
  }

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.8,
        maxOutputTokens: 5000
      }
    })
  });

  const result = await response.json();

  if (!response.ok) {
    const message = result?.error?.message || "Gemini API request failed.";
    throw new Error(message);
  }

  const text = result?.candidates?.[0]?.content?.parts
    ?.map(part => part.text || "")
    .join("");

  if (!text) {
    throw new Error("Gemini returned an empty response.");
  }

  return extractJson(text);
}

function buildBrandPrompt({brandName, description, style, color}) {
  return `
You are a professional brand identity designer.

Create a useful starter brand identity for this brand.

Brand name: ${brandName}
Business description: ${description}
Visual style: ${style}
Preferred colors: ${color}

Return ONLY valid JSON with this exact structure:
{
  "svgCode": "<svg ...>...</svg>",
  "colors": [
    {"name":"Primary","hex":"#123456"},
    {"name":"Secondary","hex":"#123456"},
    {"name":"Accent","hex":"#123456"},
    {"name":"Background","hex":"#123456"},
    {"name":"Text","hex":"#123456"}
  ],
  "fonts": {
    "heading":"Font family name",
    "headingReason":"Short reason",
    "body":"Font family name",
    "bodyReason":"Short reason"
  },
  "slogans": ["Slogan one","Slogan two","Slogan three"],
  "socialBio":"A short social media bio"
}

SVG RULES:
- Create an original, clean, professional logo concept.
- Return a complete SVG with viewBox="0 0 500 500".
- Use only basic SVG elements: svg, g, path, circle, rect, ellipse, polygon, line, polyline, text, defs, linearGradient, stop.
- Do not include scripts, foreignObject, image, use, external links, CSS imports, or event handlers.
- Use simple shapes and a clear visual symbol.
- Use the brand name only if it fits well.
- Keep all colors as literal hex values, not external references.
- Make the logo centered with generous empty space.
- Make sure the SVG is valid and self-contained.
- Use the selected style and colors.
- Do not include markdown or explanations outside the JSON.
`;
}

function buildNamesPrompt(description) {
  return `
You are a creative naming consultant.
Generate 8 original, memorable brand name ideas for this business:
${description}

Return ONLY valid JSON in this structure:
{
  "names": [
    {"name":"ExampleName","reason":"Short explanation"}
  ]
}
Names should be easy to pronounce and spell.
Do not claim that names or trademarks are legally available.
`;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return send(res, 405, { error: "Method not allowed." });
  }

  try {
    const body = req.body || {};
    const action = body.action;

    if (action === "generate") {
      const brandName = String(body.brandName || "").trim().slice(0, 40);
      const description = String(body.description || "").trim().slice(0, 500);
      const style = String(body.style || "Minimalist").slice(0, 40);
      const color = String(body.color || "let AI choose").slice(0, 60);

      if (!brandName || !description) {
        return send(res, 400, { error: "Please provide a brand name and description." });
      }

      const data = await askGemini(
        buildBrandPrompt({brandName, description, style, color})
      );

      data.svgCode = validateSvg(data.svgCode);

      if (!Array.isArray(data.colors) || data.colors.length < 3) {
        throw new Error("The AI returned an incomplete color palette.");
      }

      data.colors = data.colors.slice(0, 5).map(colorItem => {
        const hex = String(colorItem.hex || "");
        if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
          throw new Error("The AI returned an invalid color value.");
        }
        return {
          name: String(colorItem.name || "Brand color").slice(0, 30),
          hex
        };
      });

      data.slogans = Array.isArray(data.slogans)
        ? data.slogans.slice(0, 5).map(s => String(s).slice(0, 120))
        : [];

      return send(res, 200, data);
    }

    if (action === "names") {
      const description = String(body.description || "").trim().slice(0, 500);

      if (!description) {
        return send(res, 400, { error: "Please describe your business." });
      }

      const data = await askGemini(buildNamesPrompt(description));

      if (!Array.isArray(data.names)) {
        throw new Error("The AI returned an invalid name list.");
      }

      data.names = data.names.slice(0, 8).map(item => ({
        name: String(item.name || "").slice(0, 50),
        reason: String(item.reason || "").slice(0, 150)
      }));

      return send(res, 200, data);
    }

    return send(res, 400, { error: "Unknown action." });
  } catch (error) {
    console.error("PicsaLabs API error:", error.message);

    return send(res, 500, {
      error: "Could not generate your result. " + error.message
    });
  }
};

