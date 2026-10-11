# BuildLedger V6 changelog

## Explore / infographics redesign
- Reworked Explore into a more minimalist segmentation view.
- Added a donut-style category composition infographic for work, location, supplier and material groupings.
- Added tappable segment cards that jump to related records in Activity.
- Added a category-quality snapshot showing largest segment, categorisation coverage and spread.
- Added a clearer distinction between the quick segmentation view and the full ordered breakdown list.

## Robustness improvements
- Hardened category aggregation against blank labels and inconsistent values.
- Added stress tests for large category counts and repeated monthly payment data.
- Confirmed the updated UI through browser smoke tests after the chart redesign.

## Notes
- The segmentation charts continue to use posted bills only, so costs are not double-counted from payments.
- Planned payments remain separate from actual cash payments.
