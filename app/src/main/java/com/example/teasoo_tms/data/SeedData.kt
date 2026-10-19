package com.example.teasoo_tms.data

import com.example.teasoo_tms.data.entity.Sector
import com.example.teasoo_tms.data.entity.Species
import com.example.teasoo_tms.data.entity.Status
import com.example.teasoo_tms.data.entity.Subsector

object SeedData {

    val sectors = listOf(
        Sector(id = "sector-01", name = "Omo Forest Reserve", code = "OMO", latitude = 6.85, longitude = 3.92),
        Sector(id = "sector-02", name = "Oban Hills", code = "OBH", latitude = 5.35, longitude = 8.55),
        Sector(id = "sector-03", name = "Gashaka Gumti", code = "GGP", latitude = 7.35, longitude = 11.55),
    )

    val subsectors = listOf(
        Subsector(id = "sub-01", sectorId = "sector-01", name = "Omo North", code = "OMO-N", latitude = 6.90, longitude = 3.90),
        Subsector(id = "sub-02", sectorId = "sector-01", name = "Omo South", code = "OMO-S", latitude = 6.80, longitude = 3.94),
        Subsector(id = "sub-03", sectorId = "sector-02", name = "Oban East", code = "OBH-E", latitude = 5.38, longitude = 8.60),
        Subsector(id = "sub-04", sectorId = "sector-02", name = "Oban West", code = "OBH-W", latitude = 5.32, longitude = 8.50),
        Subsector(id = "sub-05", sectorId = "sector-03", name = "Gashaka Ridge", code = "GGP-R", latitude = 7.40, longitude = 11.50),
        Subsector(id = "sub-06", sectorId = "sector-03", name = "Gumti Valley", code = "GGP-V", latitude = 7.30, longitude = 11.60),
    )

    val species = listOf(
        Species(id = "sp-01", commonName = "Iroko", scientificName = "Milicia excelsa"),
        Species(id = "sp-02", commonName = "Mahogany", scientificName = "Khaya ivorensis"),
        Species(id = "sp-03", commonName = "Obeche", scientificName = "Triplochiton scleroxylon"),
        Species(id = "sp-04", commonName = "Oil palm", scientificName = "Elaeis guineensis"),
        Species(id = "sp-05", commonName = "Teak", scientificName = "Tectona grandis"),
    )

    val statuses = listOf(
        Status(id = "status-alive", name = "Alive"),
        Status(id = "status-dead", name = "Dead"),
    )
}
