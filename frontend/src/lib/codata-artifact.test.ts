import { describe, expect, it } from "vitest";

import { codataIndicatorsFromMetadata } from "./codata-artifact";

describe("codataIndicatorsFromMetadata", () => {
  it("normalizes CodataAdmin model-context indicators into card fields", () => {
    const items = codataIndicatorsFromMetadata({
      codata_kind: "indicator",
      source: "model_context",
      indicators: [
        {
          code: "total_revenue",
          name: "营业收入",
          unit: "元",
          indicator_type: "atomic",
          primary_entity: "finance_pnl_monthly",
          additivity: "additive",
          description: "按财务月确认的实际营业收入。",
          business_definition: "按财务月确认的实际营业收入。口径版本: DEMO_FIN_V1; 单位: 元。",
          impls: [
            {
              role: "primary",
              sql_text: "SELECT SUM(revenue) AS total_revenue FROM finance_demo_pnl_monthly",
              label: "DEMO_FIN 主口径",
              data_layer: "DWS",
              granularity: "month_bu_region",
            },
          ],
          available_dimensions: ["fiscal_month", "business_unit"],
        },
      ],
      total: 1,
    });

    expect(items).toEqual([
      {
        code: "total_revenue",
        name: "营业收入",
        unit: "元",
        sql: "SELECT SUM(revenue) AS total_revenue FROM finance_demo_pnl_monthly",
        description: "按财务月确认的实际营业收入。口径版本: DEMO_FIN_V1; 单位: 元。",
        indicatorType: "atomic",
        primaryEntity: "finance_pnl_monthly",
        additivity: "additive",
        dataLayer: "DWS",
        granularity: "month_bu_region",
        availableDimensions: ["fiscal_month", "business_unit"],
        match: undefined,
        score: undefined,
        needsClarify: undefined,
        notBuildable: undefined,
      },
    ]);
  });
});
