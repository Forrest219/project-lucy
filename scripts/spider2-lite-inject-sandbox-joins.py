#!/usr/bin/env python3
"""Idempotently inject Pilot FK joins into starrocks-r1 sandbox Manifest.

Usage:
  python3 scripts/spider2-lite-inject-sandbox-joins.py
  python3 scripts/spider2-lite-inject-sandbox-joins.py --manifest path/to/sandbox.yaml
"""
from __future__ import annotations

import argparse
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = ROOT / "semantic-layer/starrocks-r1/_schema/sandbox.yaml"


def j(frm: str, to: str, left: str, right: str, rel: str = "many_to_one") -> tuple[str, dict]:
    return (
        frm,
        {
            "to": to,
            "on": f"{frm}.{left} = {to}.{right}",
            "relationship": rel,
            "source": "formal",
        },
    )


def film_schema(prefix: str) -> list[tuple[str, dict]]:
    """sakila / pagila style joins."""
    p = prefix
    return [
        j(f"{p}film_actor", f"{p}actor", "actor_id", "actor_id"),
        j(f"{p}film_actor", f"{p}film", "film_id", "film_id"),
        j(f"{p}film_category", f"{p}film", "film_id", "film_id"),
        j(f"{p}film_category", f"{p}category", "category_id", "category_id"),
        j(f"{p}film", f"{p}language", "language_id", "language_id"),
        # reverse edges so bridge filters/dims can traverse without missing path
        j(f"{p}film", f"{p}film_actor", "film_id", "film_id", "one_to_many"),
        j(f"{p}film", f"{p}film_category", "film_id", "film_id", "one_to_many"),
        j(f"{p}actor", f"{p}film_actor", "actor_id", "actor_id", "one_to_many"),
        j(f"{p}category", f"{p}film_category", "category_id", "category_id", "one_to_many"),
        j(f"{p}film_text", f"{p}film", "film_id", "film_id"),
        j(f"{p}inventory", f"{p}film", "film_id", "film_id"),
        j(f"{p}inventory", f"{p}store", "store_id", "store_id"),
        j(f"{p}rental", f"{p}inventory", "inventory_id", "inventory_id"),
        j(f"{p}rental", f"{p}customer", "customer_id", "customer_id"),
        j(f"{p}rental", f"{p}staff", "staff_id", "staff_id"),
        j(f"{p}payment", f"{p}customer", "customer_id", "customer_id"),
        j(f"{p}payment", f"{p}rental", "rental_id", "rental_id"),
        j(f"{p}payment", f"{p}staff", "staff_id", "staff_id"),
        j(f"{p}customer", f"{p}address", "address_id", "address_id"),
        j(f"{p}customer", f"{p}store", "store_id", "store_id"),
        j(f"{p}address", f"{p}city", "city_id", "city_id"),
        j(f"{p}city", f"{p}country", "country_id", "country_id"),
        j(f"{p}staff", f"{p}address", "address_id", "address_id"),
        j(f"{p}staff", f"{p}store", "store_id", "store_id"),
        j(f"{p}store", f"{p}address", "address_id", "address_id"),
    ]


def chinook_joins() -> list[tuple[str, dict]]:
    return [
        j("s2_chinook_albums", "s2_chinook_artists", "ArtistId", "ArtistId"),
        j("s2_chinook_tracks", "s2_chinook_albums", "AlbumId", "AlbumId"),
        j("s2_chinook_tracks", "s2_chinook_genres", "GenreId", "GenreId"),
        j("s2_chinook_tracks", "s2_chinook_media_types", "MediaTypeId", "MediaTypeId"),
        j("s2_chinook_invoice_items", "s2_chinook_invoices", "InvoiceId", "InvoiceId"),
        j("s2_chinook_invoice_items", "s2_chinook_tracks", "TrackId", "TrackId"),
        j("s2_chinook_invoices", "s2_chinook_customers", "CustomerId", "CustomerId"),
        j("s2_chinook_customers", "s2_chinook_employees", "SupportRepId", "EmployeeId"),
        j("s2_chinook_playlist_track", "s2_chinook_playlists", "PlaylistId", "PlaylistId"),
        j("s2_chinook_playlist_track", "s2_chinook_tracks", "TrackId", "TrackId"),
    ]


def northwind_joins() -> list[tuple[str, dict]]:
    return [
        j("s2_northwind_orders", "s2_northwind_customers", "customerid", "customerid"),
        j("s2_northwind_orders", "s2_northwind_employees", "employeeid", "employeeid"),
        j("s2_northwind_orders", "s2_northwind_shippers", "shipvia", "shipperid"),
        j("s2_northwind_order_details", "s2_northwind_orders", "orderid", "orderid"),
        j("s2_northwind_order_details", "s2_northwind_products", "productid", "productid"),
        j("s2_northwind_products", "s2_northwind_categories", "categoryid", "categoryid"),
        j("s2_northwind_products", "s2_northwind_suppliers", "supplierid", "supplierid"),
        j("s2_northwind_employeeterritories", "s2_northwind_employees", "employeeid", "employeeid"),
        j("s2_northwind_employeeterritories", "s2_northwind_territories", "territoryid", "territoryid"),
        j("s2_northwind_territories", "s2_northwind_region", "regionid", "regionid"),
        j("s2_northwind_customercustomerdemo", "s2_northwind_customers", "customerid", "customerid"),
        j(
            "s2_northwind_customercustomerdemo",
            "s2_northwind_customerdemographics",
            "customertypeid",
            "customertypeid",
        ),
        # customergroupthreshold is range bands by groupname — no FK to customers; omit join
    ]


def ecommerce_joins() -> list[tuple[str, dict]]:
    return [
        j("s2_ecommerce_orders", "s2_ecommerce_customers", "customer_id", "customer_id"),
        j("s2_ecommerce_order_items", "s2_ecommerce_orders", "order_id", "order_id"),
        j("s2_ecommerce_order_items", "s2_ecommerce_products", "product_id", "product_id"),
        j("s2_ecommerce_order_items", "s2_ecommerce_sellers", "seller_id", "seller_id"),
        j("s2_ecommerce_order_payments", "s2_ecommerce_orders", "order_id", "order_id"),
        j("s2_ecommerce_order_reviews", "s2_ecommerce_orders", "order_id", "order_id"),
        j(
            "s2_ecommerce_products",
            "s2_ecommerce_product_category_name_translation",
            "product_category_name",
            "product_category_name",
        ),
        j("s2_ecommerce_leads_closed", "s2_ecommerce_leads_qualified", "mql_id", "mql_id"),
        j("s2_ecommerce_leads_closed", "s2_ecommerce_sellers", "seller_id", "seller_id"),
    ]


def all_joins() -> list[tuple[str, dict]]:
    out: list[tuple[str, dict]] = []
    out.extend(film_schema("s2_sakila_"))
    out.extend(film_schema("s2_pagila_"))
    out.extend(chinook_joins())
    out.extend(northwind_joins())
    out.extend(ecommerce_joins())
    return out


def inject(manifest: Path) -> dict:
    doc = yaml.safe_load(manifest.read_text())
    tables = doc.setdefault("tables", {})
    added = 0
    skipped = 0
    missing_tbl = 0
    for frm, join in all_joins():
        if frm not in tables:
            missing_tbl += 1
            continue
        if join["to"] not in tables:
            missing_tbl += 1
            continue
        existing = tables[frm].setdefault("joins", [])
        # idempotent: match on `to` + `on`
        key = (join["to"], join["on"])
        if any((e.get("to"), e.get("on")) == key for e in existing):
            skipped += 1
            continue
        existing.append(join)
        added += 1
    # stable dump
    class Dumper(yaml.SafeDumper):
        pass

    def str_representer(dumper, data):
        if "\n" in data:
            return dumper.represent_scalar("tag:yaml.org,2002:str", data, style="|")
        return dumper.represent_scalar("tag:yaml.org,2002:str", data)

    Dumper.add_representer(str, str_representer)
    manifest.write_text(
        yaml.dump(doc, Dumper=Dumper, sort_keys=False, allow_unicode=True, width=120)
    )
    return {"added": added, "skipped": skipped, "missing_tbl": missing_tbl, "path": str(manifest)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    args = ap.parse_args()
    stats = inject(args.manifest)
    print(f"[spider2-inject-joins] added={stats['added']} skipped={stats['skipped']} "
          f"missing={stats['missing_tbl']} → {stats['path']}")


if __name__ == "__main__":
    main()
