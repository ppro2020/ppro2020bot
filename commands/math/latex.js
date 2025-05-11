const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const katex = require('katex');
const puppeteer = require('puppeteer');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('latex')
    .setDescription('Renders a math equation from an input. Use $...$ for inline or $$...$$ for display mode.')
    .addStringOption(option =>
      option.setName('expression')
        .setDescription('The LaTeX expression to render (e.g., $x^2$ or $$\\frac{1}{2}$$)')
        .setRequired(true)),
  async execute(interaction) {
    // Defer reply since rendering may take time
    await interaction.deferReply();

    // Get the LaTeX code from the slash command option
    const latexCode = interaction.options.getString('expression')?.trim();

    // Check if latexCode is valid
    if (!latexCode) {
      return interaction.editReply('Please provide a valid LaTeX expression, e.g., `$x^2$` or `$$\\frac{1}{2}$$`.');
    }

    // Check for inline ($...$) or display ($$...$$) delimiters
    const inlineMatch = latexCode.match(/\$([^$]+)\$/);
    const displayMatch = latexCode.match(/\$\$([^$]+)\$\$/);

    let expression = latexCode;
    let displayMode = false;

    if (inlineMatch) {
      expression = inlineMatch[1];
    } else if (displayMatch) {
      expression = displayMatch[1];
      displayMode = true;
    } else {
      // If no delimiters, assume it's an inline expression
      expression = latexCode;
    }

    try {
      // Render LaTeX using KaTeX
      const html = katex.renderToString(expression, {
        displayMode: displayMode,
        throwOnError: true,
        output: 'html',
      });

      // Launch Puppeteer
      const browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      const page = await browser.newPage();

      // Set a larger viewport to handle taller expressions like square roots
      await page.setViewport({ width: 800, height: 400 });

      // Set the content with KaTeX CSS and proper HTML structure
      const htmlWithCSS = `
        <html>
          <head>
            <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css" crossorigin="anonymous">
            <style>
              body {
                margin: 0;
                padding: 0;
                display: flex;
                justify-content: center;
                align-items: center;
                background-color: #ffffff;
              }
              #katex-output {
                font-size: 30px;
                padding: 20px;
              }
            </style>
          </head>
          <body>
            <div id="katex-output">${html}</div>
          </body>
        </html>
      `;

      // Set the HTML content and wait for the network to be idle (CSS loaded)
      await page.setContent(htmlWithCSS, { waitUntil: 'networkidle0' });

      // Wait for the element to be rendered
      await page.waitForSelector('#katex-output');

      await new Promise(resolve => setTimeout(resolve, 500));

      // Take a screenshot of the rendered element
      const element = await page.$('#katex-output');
      const buffer = await element.screenshot();

      // Close the browser
      await browser.close();

      // Create attachment and send it
      const attachment = new AttachmentBuilder(buffer, { name: 'latex-output.png' });
      await interaction.editReply({ files: [attachment] });
    } catch (error) {
      console.error('Error rendering LaTeX:', error);
      await interaction.editReply(`Error rendering LaTeX: ${error.message}`);
    }
  },
};