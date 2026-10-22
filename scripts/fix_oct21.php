<?php
/**
 * Fix Oct 21 2026 Daily Closing in MySQL.
 * Correct prepared_qty for Pork BBQ: prev_stock=7, received=0, so prepared=7 (not 18).
 * All other products already had correct values.
 */
$pdo = new PDO('mysql:host=localhost;dbname=pos_system;charset=utf8', 'root', '');
$st = $pdo->query("SELECT items_data FROM daily_closings WHERE date = '2026-10-21'");
$r = $st->fetch(PDO::FETCH_ASSOC);
if (!$r) { die("Oct 21 not found\n"); }

$items = json_decode($r['items_data'], true);

// Recalculate each item based on: prepared = prev_stock + received_qty
$totPrep = 0;
$totSold = 0;
$totUnsold = 0;
$totSpoil = 0;
$totRev = 0;
$totCogs = 0;
$totGp = 0;

foreach ($items as &$it) {
    // Correct prepared = prev_stock + received_qty (NOT curStock)
    $correctPrep = (int)$it['prev_stock'] + (int)$it['received_qty'];
    $sold = (int)$it['sold_qty'];
    $spoil = (int)$it['spoilage_qty'];
    $unsold = max(0, $correctPrep - $sold - $spoil);
    $price = (float)$it['selling_price'];
    $cost = (float)$it['unit_cost'];

    $it['prepared_qty'] = $correctPrep;
    $it['unsold_qty'] = $unsold;
    $it['actual_revenue'] = $sold * $price;
    $it['cogs'] = $sold * $cost;
    $it['gross_profit'] = $it['actual_revenue'] - $it['cogs'];
    $it['spoilage_loss'] = $spoil * $price;
    $it['discrepancy'] = ($sold + $unsold + $spoil) - $correctPrep;

    $totPrep += $correctPrep;
    $totSold += $sold;
    $totUnsold += $unsold;
    $totSpoil += $spoil;
    $totRev += $it['actual_revenue'];
    $totCogs += $it['cogs'];
    $totGp += $it['gross_profit'];

    echo "[{$it['product_id']}] {$it['product_name']}: prev={$it['prev_stock']}, rec={$it['received_qty']}, prep={$correctPrep}, unsold={$unsold}\n";
}
unset($it);

// Update daily_closings
$up = $pdo->prepare("UPDATE daily_closings SET
    total_prepared = :prep,
    total_sold = :sold,
    total_unsold = :unsold,
    total_spoilage = :spoil,
    total_revenue = :rev,
    total_cogs = :cogs,
    total_gross_profit = :gp,
    items_data = :items,
    status = 'DRAFT',
    finalized_at = NULL
    WHERE date = '2026-10-21'");
$up->execute([
    ':prep' => $totPrep,
    ':sold' => $totSold,
    ':unsold' => $totUnsold,
    ':spoil' => $totSpoil,
    ':rev' => $totRev,
    ':cogs' => $totCogs,
    ':gp' => $totGp,
    ':items' => json_encode($items),
]);
echo "\nUpdated Oct 21: Prepared=$totPrep, Sold=$totSold, Unsold=$totUnsold\n";

// Update products current_stock = unsold_qty
$upP = $pdo->prepare('UPDATE products SET current_stock = :stock, updated_at = NOW() WHERE id = :id');
foreach ($items as $it) {
    $upP->execute([':stock' => $it['unsold_qty'], ':id' => $it['product_id']]);
    echo "  Product {$it['product_id']} ({$it['product_name']}) stock = {$it['unsold_qty']}\n";
}
echo "\nDone!\n";
