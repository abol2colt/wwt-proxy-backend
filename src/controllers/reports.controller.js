function createReportsController({
  getAiMissingEnv,
  generateReportSummary,
  env,
}) {
  async function generateAiSummary(req, res) {
    const missingAiEnv = getAiMissingEnv();

    if (missingAiEnv.length > 0) {
      return res.status(500).json({
        success: false,
        error: `AI configuration is incomplete: ${missingAiEnv.join(", ")}`,
      });
    }

    try {
      const result = await generateReportSummary(req.body ?? {});

      return res.json({
        success: true,
        summary: result.summary,
        model: result.model,
      });
    } catch (err) {
      const status = err.response?.status ?? 500;
      const providerMessage =
        err.code === "ECONNABORTED"
          ? "AI provider request timed out after 45 seconds."
          : (err.response?.data?.error?.message ??
            err.response?.data?.message ??
            err.message);

      console.error("AI Report Gen failed", {
        status,
        code: err.code,
        message: err.message,
        providerMessage,
      });

      return res.status(500).json({
        success: false,
        error:
          "AI Summary generation failed. Check proxy and AI configuration.",
        debug:
          env.nodeEnv === "development"
            ? {
                status,
                code: err.code,
                providerMessage,
              }
            : undefined,
      });
    }
  }

  return {
    generateAiSummary,
  };
}

module.exports = {
  createReportsController,
};
